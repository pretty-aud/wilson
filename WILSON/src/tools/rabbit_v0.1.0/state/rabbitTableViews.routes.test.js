// =============================================================================
// rabbitTableViews.routes.test.js — VW1c (0098's twin on the Local Server):
// bundle.tableViews and bundle.itemGroupings, their routes, the revision
// counter kept in the project file, the sweep (fn_item_groupings_forget's
// twin) on the generic delete routes, the asset route and every read, and this
// machine's last used view — replayed over an in-memory bundle with the REAL
// functions: the module, and main.cjs's writeRabbitBundle, readRabbitBundle,
// rabbitSubentityRoutes and asset DELETE route lifted out of it the way
// desktopDeleteSweep.test.js and rabbitShotLists.routes.test.js lift them.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const tv = require('../../../../electron/rabbitTableViews.cjs')
const rabbitTaskItems = require('../../../../electron/rabbitTaskItems.cjs')
const {
  cascadeSceneOrShotDelete, backfillShotListsOnRead, ensureShotListKeys, pruneDanglingShotListItems,
} = require('../../../../electron/rabbitShotLists.cjs')
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
function extractRouteBody(source, head) {
  const start = source.indexOf(head)
  if (start < 0) throw new Error(`main.cjs no longer registers ${head}`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(open, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${head}`)
}

const PID = 'proj-1'
const UUID = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f'
const OLD = '2026-01-01T00:00:00.000Z'
function bundleOf(extra = {}) {
  return {
    project: { id: PID, title: 'P', updated_at: OLD },
    assets: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
    scenes: [{ id: 'S1' }, { id: 'S2' }],
    shots: [{ id: 'H1', scene_id: 'S1' }, { id: 'H2', scene_id: 'S2' }],
    levels: [{ id: 'L1' }, { id: 'L2' }],
    experiences: [{ id: 'X1' }],
    tasks: [], taskItems: [], shotLists: [], shotListItems: [], edits: [], dependencies: [],
    tableViews: [], itemGroupings: [],
    ...extra,
  }
}
const grouping = (id, table, kind, ids, created_at = '2026-10-17T10:00:00.000Z') =>
  ({ id, project_id: PID, table_key: table, kind, entity_ids: ids, created_at, created_by: null, updated_at: created_at, updated_by: null })
const stored = (id, table, position, revision, extra = {}) => ({
  id, project_id: PID, table_key: table, name: id, position, revision, revised_by: null, config: { version: 1 },
  created_at: '2026-10-17T10:00:00.000Z', created_by: null, updated_at: '2026-10-17T10:00:00.000Z', updated_by: null, ...extra,
})

// A route table and a synchronous caller: every handler here must answer
// before it returns (no promise), or two writes could interleave.
function app() {
  const routes = new Map()
  const reg = (verb) => (pattern, h) => routes.set(`${verb} ${pattern}`, h)
  return { routes, expressApp: { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') } }
}
function call(routes, verb, pattern, params = {}, body = {}, query = {}) {
  const handler = routes.get(`${verb} ${pattern}`)
  if (!handler) throw new Error(`no route for ${verb} ${pattern}`)
  const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  const out = handler({ params: { projectId: PID, ...params }, body, query }, res)
  expect(out != null && typeof out.then === 'function', `${verb} ${pattern} answers synchronously`).toBe(false)
  return res
}

// main.cjs's REAL writeRabbitBundle, over a fake disk: it stamps
// project.updated_at and re-mirrors _DATABASES only when touch is true.
function realWriteRabbitBundle(log) {
  // eslint-disable-next-line no-new-func
  const write = new Function('writeJSON', 'rabbitBundlePath', 'mirrorProjectDatabases',
    `${extractFunction(MAIN_CJS, 'writeRabbitBundle')}\nreturn writeRabbitBundle;`)(
    (file, data) => { log.disk.push(structuredClone(data)) },
    (id) => `/fake/${id}/project.json`,
    (id) => { log.mirrors.push(id) },
  )
  return (id, bundle, opts) => { log.opts.push(opts); write(id, bundle, opts) }
}

const DATA = path.join('/fake', 'otter-data')
const SETTINGS = path.join(DATA, 'rabbit-machine-settings.json')
function mounted(bundle, files = new Map()) {
  const { routes, expressApp } = app()
  const log = { disk: [], mirrors: [], opts: [] }
  let seq = 0
  tv.mountRabbitTableViews(expressApp, {
    readRabbitBundle: (id) => (id === PID ? bundle : null),
    writeRabbitBundle: realWriteRabbitBundle(log),
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    uuidv4: () => `id-${++seq}`,
    getDataDir: () => DATA,
    readJSON: (file, fallback = null) => (files.has(file) ? JSON.parse(files.get(file)) : fallback),
    writeJSON: (file, data) => { files.set(file, JSON.stringify(data)) },
  })
  return { routes, log, files, writes: log.disk }
}
const V = '/api/rabbit/projects/:projectId/table-views'
const VID = `${V}/:viewId`
const G = '/api/rabbit/projects/:projectId/item-groupings'
const GID = `${G}/:groupingId`
const M = '/api/rabbit/machine-settings'
const ML = `${M}/table-view-last`

describe('mounting', () => {
  it('refuses without an express app or a helper', () => {
    const deps = { readRabbitBundle() {}, writeRabbitBundle() {}, rabbitNotFound() {}, uuidv4() {}, getDataDir() {}, readJSON() {}, writeJSON() {} }
    expect(() => tv.mountRabbitTableViews(null, deps)).toThrow(/express app/)
    for (const k of Object.keys(deps)) {
      const { [k]: _gone, ...rest } = deps
      expect(() => tv.mountRabbitTableViews(app().expressApp, rest), k).toThrow(k === 'uuidv4' ? /uuidv4/ : new RegExp(k))
    }
    expect(() => tv.mountRabbitTableViews(app().expressApp, deps)).not.toThrow()
  })
})

describe('GET /table-views', () => {
  it('answers the views in the loads\' order (table, then position, created_at, id), and 404 for an unknown project', () => {
    const b = bundleOf({
      tableViews: [
        stored('t-2', 'tasks', 1, 4), stored('a-1', 'assets', 3, 2), stored('t-1', 'tasks', 0, 3),
        stored('t-0', 'tasks', 1, 1, { created_at: '2026-10-17T09:00:00.000Z' }), null,
      ],
    })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'GET', V).body.map(v => v.id)).toEqual(['a-1', 't-1', 't-0', 't-2'])
    expect(call(routes, 'GET', V, { projectId: 'nope' }).code).toBe(404)
    expect(writes).toHaveLength(0)
  })
  it('an old bundle with neither array answers [] for both', () => {
    const b = bundleOf()
    delete b.tableViews
    delete b.itemGroupings
    const { routes } = mounted(b)
    expect(call(routes, 'GET', V).body).toEqual([])
    expect(call(routes, 'GET', G).body).toEqual([])
  })
})

describe('POST /table-views — an INSERT', () => {
  it('makes a view: its name trimmed, after the table\'s last, config {} by default, revision 1, no person stamped; one write', () => {
    const b = bundleOf({ tableViews: [stored('t-1', 'tasks', 4, 0), stored('a-1', 'assets', 9, 0)] })
    b.tableViewRevision = 0
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', V, {}, { table_key: 'tasks', name: '  Mine  ' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({
      id: 'id-1', project_id: PID, table_key: 'tasks', name: 'Mine', position: 5, revision: 1,
      revised_by: null, config: {}, created_by: null, updated_by: null,
    })
    expect(Object.keys(r.body).sort()).toEqual(['config', 'created_at', 'created_by', 'id', 'name', 'position', 'project_id',
      'revised_by', 'revision', 'table_key', 'updated_at', 'updated_by'])
    expect(r.body.created_at).toBe(r.body.updated_at)
    expect(writes).toHaveLength(1)
    expect(writes[0].tableViews.at(-1)).toEqual(r.body)
    expect(writes[0].tableViewRevision).toBe(1)
  })

  it('takes the id, the position and the config it is given (a delete\'s undo makes the view again with its id)', () => {
    const b = bundleOf()
    const { routes } = mounted(b)
    const config = { version: 1, sorts: [{ field: 'title', dir: 'asc' }], unknownKey: { kept: true } }
    const r = call(routes, 'POST', V, {}, { id: UUID, table_key: 'shots', name: 'Edit', position: 0, config, project_id: 'ignored', revision: 99 })
    expect(r.body).toMatchObject({ id: UUID, project_id: PID, table_key: 'shots', position: 0, config, revision: 1 })
  })

  it('refuses a bad table, name, config, position or id with 400 table_view_invalid, and writes nothing', () => {
    const b = bundleOf({ tableViews: [stored('t-1', 'tasks', 0, 1)] })
    const { routes, writes } = mounted(b)
    const ok = { table_key: 'tasks', name: 'x' }
    const bad = [
      { ...ok, table_key: 'milestones' }, { ...ok, table_key: undefined }, { ...ok, table_key: 'Tasks' },
      { ...ok, name: '' }, { ...ok, name: '   ' }, { ...ok, name: 'a'.repeat(81) }, { ...ok, name: 'a\nb' }, { ...ok, name: 7 },
      { ...ok, config: [] }, { ...ok, config: 'x' }, { ...ok, config: { k: 'x'.repeat(32761) } },
      { ...ok, position: -1 }, { ...ok, position: 1.5 }, { ...ok, position: '3' }, { ...ok, position: 2147483648 },
      { ...ok, id: 'all' }, { ...ok, id: 'has space' }, { ...ok, id: 'a/b' }, { ...ok, id: { x: 1 } }, { ...ok, id: 'x'.repeat(65) },
    ]
    for (const body of bad) {
      const r = call(routes, 'POST', V, {}, body)
      expect(r, JSON.stringify(body).slice(0, 80)).toMatchObject({ code: 400, body: { code: 'table_view_invalid' } })
      expect(typeof r.body.error).toBe('string')
    }
    expect(call(routes, 'POST', V, {}, { ...ok, name: 'a'.repeat(81) }).body.error).toBe('A view\'s name can be at most 80 characters.')
    expect(writes).toHaveLength(0)
    expect(b.tableViews).toHaveLength(1)
    // The edges pass: 80 characters, 32,768 bytes, position 2147483647.
    expect(call(routes, 'POST', V, {}, { ...ok, name: 'a'.repeat(80), config: { k: 'x'.repeat(32760) }, position: 2147483647 }).code).toBe(200)
  })

  it('refuses an id already used with 409 table_view_id_taken', () => {
    const b = bundleOf({ tableViews: [stored('taken', 'assets', 0, 1)] })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', V, {}, { id: 'taken', table_key: 'tasks', name: 'x' }))
      .toMatchObject({ code: 409, body: { code: 'table_view_id_taken' } })
    expect(writes).toHaveLength(0)
  })

  it('holds at most 200 views per table (422 table_view_cap, the cloud\'s words); another table still takes one', () => {
    const tableViews = Array.from({ length: 200 }, (_, i) => stored(`v${i}`, 'levels', i, i + 1))
    const b = bundleOf({ tableViews })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', V, {}, { table_key: 'levels', name: 'one more' })).toEqual(expect.objectContaining({
      code: 422, body: { code: 'table_view_cap', error: 'A project\'s Levels table holds at most 200 saved views.' },
    }))
    expect(writes).toHaveLength(0)
    expect(call(routes, 'POST', V, {}, { table_key: 'experiences', name: 'fine' }).code).toBe(200)
  })
})

describe('the revision: one counter in the project file, never reused', () => {
  it('a new view and every change of config take the next number; a rename and a reorder keep it and leave the counter', () => {
    const b = bundleOf()
    const { routes } = mounted(b)
    const one = call(routes, 'POST', V, {}, { id: 'v1', table_key: 'tasks', name: 'One' }).body
    const two = call(routes, 'POST', V, {}, { id: 'v2', table_key: 'tasks', name: 'Two' }).body
    expect([one.revision, two.revision, b.tableViewRevision]).toEqual([1, 2, 2])
    const saved = call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, sorts: [{ field: 'status', dir: 'desc' }] } }).body
    expect(saved.revision).toBe(3)
    const renamed = call(routes, 'PATCH', VID, { viewId: 'v1' }, { name: 'Renamed' }).body
    expect(renamed).toMatchObject({ name: 'Renamed', revision: 3, revised_by: null })
    call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'tasks', ids: ['v2', 'v1'] })
    expect(b.tableViews.find(v => v.id === 'v1')).toMatchObject({ position: 1, revision: 3 })
    expect(b.tableViews.find(v => v.id === 'v2')).toMatchObject({ position: 0, revision: 2 })
    expect(b.tableViewRevision).toBe(3)
  })

  it('a view deleted and made again with the same id takes a number no view ever had', () => {
    const b = bundleOf()
    const { routes, writes } = mounted(b)
    call(routes, 'POST', V, {}, { id: 'v1', table_key: 'tasks', name: 'One' })
    call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, filters: [] } })
    expect(b.tableViews[0].revision).toBe(2)
    expect(call(routes, 'DELETE', VID, { viewId: 'v1' }).body).toEqual({ ok: true, removed: true })
    expect(b.tableViews).toEqual([])
    const again = call(routes, 'POST', V, {}, { id: 'v1', table_key: 'tasks', name: 'One' }).body
    expect(again.revision).toBe(3)
    // The counter is in the file the disk got.
    expect(writes.at(-1).tableViewRevision).toBe(3)
  })

  it('a bundle with no counter starts after the largest revision stored; a counter below a stored revision is passed over', () => {
    const b = bundleOf({ tableViews: [stored('a', 'tasks', 0, 7), stored('b', 'assets', 0, 3)] })
    const { routes } = mounted(b)
    expect(call(routes, 'POST', V, {}, { table_key: 'tasks', name: 'x' }).body.revision).toBe(8)
    const c = bundleOf({ tableViews: [stored('a', 'tasks', 0, 7)] })
    c.tableViewRevision = 2
    expect(call(mounted(c).routes, 'POST', V, {}, { table_key: 'tasks', name: 'x' }).body.revision).toBe(8)
  })

  it('FAILING CONTROL: a counter above every stored revision (views deleted since) is honoured, not the largest stored', () => {
    const b = bundleOf({ tableViews: [stored('a', 'tasks', 0, 4)] })
    b.tableViewRevision = 41
    const { routes } = mounted(b)
    expect(call(routes, 'POST', V, {}, { table_key: 'tasks', name: 'x' }).body.revision).toBe(42)
    expect(call(routes, 'PATCH', VID, { viewId: 'a' }, { config: { version: 1, keyDates: false } }).body.revision).toBe(43)
  })
})

describe('PATCH /table-views/:viewId', () => {
  function seeded() {
    const b = bundleOf({ tableViews: [stored('v1', 'tasks', 0, 5, { name: 'Mine', config: { version: 1, b: 2, a: 1 } })] })
    b.tableViewRevision = 5
    return b
  }

  it('a rename keeps the revision, created_at and the config; updated_at moves; one write', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'PATCH', VID, { viewId: 'v1' }, { name: '  Ours ' })
    expect(r.body).toMatchObject({ name: 'Ours', revision: 5, created_at: '2026-10-17T10:00:00.000Z', config: { version: 1, b: 2, a: 1 } })
    expect(r.body.updated_at).not.toBe('2026-10-17T10:00:00.000Z')
    expect(writes).toHaveLength(1)
    expect(b.tableViewRevision).toBe(5)
  })

  it('a config that differs takes a new revision; one equal but for key order takes none and writes nothing', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const same = call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { a: 1, version: 1, b: 2 } })
    expect(same.body).toMatchObject({ revision: 5 })
    expect(writes).toHaveLength(0)
    const changed = call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, a: 1, b: 3 } })
    expect(changed.body).toMatchObject({ revision: 6, config: { version: 1, a: 1, b: 3 }, revised_by: null })
    expect(writes).toHaveLength(1)
  })

  it('a name and a config together take one new revision; a move alone takes none', () => {
    const b = seeded()
    const { routes } = mounted(b)
    expect(call(routes, 'PATCH', VID, { viewId: 'v1' }, { name: 'Both', config: { version: 1 } }).body).toMatchObject({ name: 'Both', revision: 6 })
    expect(call(routes, 'PATCH', VID, { viewId: 'v1' }, { position: 4 }).body).toMatchObject({ position: 4, revision: 6 })
  })

  it('expectRevision: another revision is refused 409 table_view_stale WITH the stored row, and nothing is written; the same one saves', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const before = structuredClone(b.tableViews[0])
    const r = call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, x: 1 }, expectRevision: 4 })
    expect(r.code).toBe(409)
    expect(r.body).toMatchObject({ code: 'table_view_stale', row: before })
    expect(typeof r.body.error).toBe('string')
    expect(writes).toHaveLength(0)
    expect(b.tableViews[0]).toEqual(before)
    expect(call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, x: 1 }, expectRevision: 5 }).body).toMatchObject({ revision: 6 })
  })

  it('expectName (a rename\'s undo): another name is refused 409 with the stored row; the same name saves', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'PATCH', VID, { viewId: 'v1' }, { name: 'Back', expectName: 'Not mine' })
    expect(r).toMatchObject({ code: 409, body: { code: 'table_view_stale', row: { name: 'Mine' } } })
    expect(writes).toHaveLength(0)
    expect(call(routes, 'PATCH', VID, { viewId: 'v1' }, { name: 'Back', expectName: 'Mine' }).body).toMatchObject({ name: 'Back', revision: 5 })
  })

  it('a view that is not there is 404 table_view_not_found; a bad name, position or config is 400 and writes nothing', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    expect(call(routes, 'PATCH', VID, { viewId: 'gone' }, { name: 'x' })).toMatchObject({ code: 404, body: { code: 'table_view_not_found' } })
    expect(call(routes, 'PATCH', VID, { viewId: 'gone' }, { name: 'x' }, {}).body.row).toBeUndefined()
    for (const body of [{ name: '' }, { name: null }, { position: -1 }, { position: null }, { config: [] }, { config: null }, { config: { k: 'x'.repeat(32761) } }]) {
      expect(call(routes, 'PATCH', VID, { viewId: 'v1' }, body), JSON.stringify(body).slice(0, 60))
        .toMatchObject({ code: 400, body: { code: 'table_view_invalid' } })
    }
    expect(writes).toHaveLength(0)
  })

  it('only name, position and config are written: an id, a table, a project, a revision or a stamp in the body are ignored', () => {
    const b = seeded()
    const { routes } = mounted(b)
    const r = call(routes, 'PATCH', VID, { viewId: 'v1' }, {
      name: 'New', id: 'other', table_key: 'assets', project_id: 'other', revision: 999, revised_by: 'me', created_at: OLD, created_by: 'me',
    })
    expect(r.body).toMatchObject({ id: 'v1', table_key: 'tasks', project_id: PID, revision: 5, revised_by: null, created_at: '2026-10-17T10:00:00.000Z', created_by: null })
  })
})

describe('DELETE /table-views/:viewId', () => {
  it('removes the view; 404 when it is not there; ?expectRevision guards it (409 with the stored row)', () => {
    const b = bundleOf({ tableViews: [stored('v1', 'tasks', 0, 5), stored('v2', 'tasks', 1, 6)] })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'DELETE', VID, { viewId: 'nope' })).toMatchObject({ code: 404, body: { code: 'table_view_not_found' } })
    const stale = call(routes, 'DELETE', VID, { viewId: 'v1' }, {}, { expectRevision: '4' })
    expect(stale).toMatchObject({ code: 409, body: { code: 'table_view_stale', row: { id: 'v1', revision: 5 } } })
    expect(writes).toHaveLength(0)
    expect(call(routes, 'DELETE', VID, { viewId: 'v1' }, {}, { expectRevision: '5' }).body).toEqual({ ok: true, removed: true })
    expect(call(routes, 'DELETE', VID, { viewId: 'v2' }, {}, { expectRevision: '' }).body).toEqual({ ok: true, removed: true })
    expect(b.tableViews).toEqual([])
    expect(writes).toHaveLength(2)
  })
})

describe('POST /table-views/reorder — reorder_table_views\' twin', () => {
  function four() {
    return bundleOf({
      tableViews: [
        stored('r1', 'tasks', 0, 1), stored('r2', 'tasks', 1, 2), stored('r3', 'tasks', 2, 3, { created_at: '2026-10-17T11:00:00.000Z' }),
        stored('r4', 'tasks', 2, 4, { created_at: '2026-10-17T09:00:00.000Z' }), stored('o1', 'assets', 0, 5),
      ],
    })
  }
  it('puts the named first, the rest after in their current order, dense from 0; answers the moved rows; no revision moves', () => {
    const b = four()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'tasks', ids: ['r3'] })
    expect(r.body.map(v => `${v.id}:${v.position}`)).toEqual(['r3:0', 'r1:1', 'r2:2', 'r4:3'])
    expect(tv.viewsOfTable(b.tableViews, 'tasks').map(v => `${v.id}:${v.position}:${v.revision}`)).toEqual(['r3:0:3', 'r1:1:1', 'r2:2:2', 'r4:3:4'])
    expect(r.body.every(v => v.updated_at !== '2026-10-17T10:00:00.000Z')).toBe(true)
    expect(b.tableViews.find(v => v.id === 'o1')).toEqual(stored('o1', 'assets', 0, 5))
    expect(writes).toHaveLength(1)
  })
  it('a list that moves nothing answers [] and writes nothing; a refusal is 400 table_view_invalid in the model\'s words', () => {
    const b = four()
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'assets', ids: ['o1'] }).body).toEqual([])
    expect(call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'tasks', ids: ['r1', 'r1'] }))
      .toMatchObject({ code: 400, body: { code: 'table_view_invalid', error: 'a view is named twice' } })
    expect(call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'nope', ids: [] }).code).toBe(400)
    expect(call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'tasks', ids: [''] }).code).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('is registered before the :viewId routes, so "reorder" is never read as an id', () => {
    const { routes } = mounted(four())
    const keys = [...routes.keys()]
    const at = keys.indexOf(`POST ${V}/reorder`)
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(keys.indexOf(`PATCH ${VID}`))
    expect(at).toBeLessThan(keys.indexOf(`DELETE ${VID}`))
  })
})

describe('the groupings\' routes', () => {
  it('GET answers them by table, kind, created_at, id', () => {
    const b = bundleOf({
      itemGroupings: [
        grouping('g3', 'tasks', 'scene', ['S1']), grouping('g2', 'tasks', 'asset', ['A2'], '2026-10-17T11:00:00.000Z'),
        grouping('g1', 'tasks', 'asset', ['A1'], '2026-10-17T12:00:00.000Z'), grouping('g0', 'assets', 'scene', ['S1']),
      ],
    })
    expect(call(mounted(b).routes, 'GET', G).body.map(g => g.id)).toEqual(['g0', 'g2', 'g1', 'g3'])
  })

  it('POST makes one, its ids stored sorted and distinct, no person stamped; one write', () => {
    const b = bundleOf()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', G, {}, { table_key: 'tasks', kind: 'asset', entity_ids: ['A3', 'A1', 'A3'], project_id: 'ignored' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ id: 'id-1', project_id: PID, table_key: 'tasks', kind: 'asset', entity_ids: ['A1', 'A3'], created_by: null, updated_by: null })
    expect(Object.keys(r.body).sort()).toEqual(['created_at', 'created_by', 'entity_ids', 'id', 'kind', 'project_id', 'table_key', 'updated_at', 'updated_by'])
    expect(writes).toHaveLength(1)
  })

  it('the same set again (any order, repeats) answers the STORED row and writes nothing', () => {
    const b = bundleOf({ itemGroupings: [grouping('g1', 'tasks', 'asset', ['A1', 'A3'])] })
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', G, {}, { id: 'other', table_key: 'tasks', kind: 'asset', entity_ids: ['A3', 'A1', 'A1'] })
    expect(r.code).toBe(200)
    expect(r.body).toEqual(b.itemGroupings[0])
    expect(writes).toHaveLength(0)
    // The same set in another table or kind is another grouping.
    expect(call(routes, 'POST', G, {}, { table_key: 'levels', kind: 'asset', entity_ids: ['A1', 'A3'] }).body.id).not.toBe('g1')
  })

  it('refuses a bad shape (400 item_grouping_invalid), an id no row of its kind has (422, the cloud\'s 23503 twin) and an id taken (409)', () => {
    const b = bundleOf({ itemGroupings: [grouping('taken', 'tasks', 'scene', ['S1'])] })
    const { routes, writes } = mounted(b)
    for (const body of [
      { table_key: 'scenes', kind: 'asset', entity_ids: ['A1'] }, { table_key: 'assets', kind: 'asset', entity_ids: ['A1'] },
      { table_key: 'tasks', kind: 'asset', entity_ids: [] }, { table_key: 'tasks', kind: 'asset', entity_ids: ['A1', 7] },
      { table_key: 'tasks', kind: 'asset', entity_ids: Array.from({ length: 101 }, (_, i) => `a${i}`) },
      { id: 'a b', table_key: 'tasks', kind: 'asset', entity_ids: ['A1'] },
    ]) {
      expect(call(routes, 'POST', G, {}, body), JSON.stringify(body).slice(0, 60)).toMatchObject({ code: 400, body: { code: 'item_grouping_invalid' } })
    }
    // A scene's id named as an asset, and an asset of no row.
    const r = call(routes, 'POST', G, {}, { table_key: 'tasks', kind: 'asset', entity_ids: ['A1', 'S1', 'GONE'] })
    expect(r).toMatchObject({ code: 422, body: { code: 'item_grouping_entity_not_found' } })
    expect(r.body.error).toBe('A grouping can name only this project\'s own assets: 2 of the 3 named are not in it.')
    expect(call(routes, 'POST', G, {}, { id: 'taken', table_key: 'tasks', kind: 'asset', entity_ids: ['A1'] }))
      .toMatchObject({ code: 409, body: { code: 'item_grouping_id_taken' } })
    expect(writes).toHaveLength(0)
  })

  it('holds at most 500 groupings per table (422 item_grouping_cap, the cloud\'s words), whatever their kind', () => {
    // They name real rows, so the read's sweep keeps them (the routes keep a
    // set unique; the cap counts the table, every kind).
    const itemGroupings = Array.from({ length: 500 }, (_, i) => grouping(`g${i}`, 'assets', i % 2 ? 'scene' : 'level', [i % 2 ? 'S1' : 'L1']))
    const b = bundleOf({ itemGroupings })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', G, {}, { table_key: 'assets', kind: 'shot', entity_ids: ['H1'] })).toEqual(expect.objectContaining({
      code: 422, body: { code: 'item_grouping_cap', error: 'A project\'s Assets table holds at most 500 groupings.' },
    }))
    expect(writes).toHaveLength(0)
    expect(call(routes, 'POST', G, {}, { table_key: 'tasks', kind: 'shot', entity_ids: ['H1'] }).code).toBe(200)
  })

  it('DELETE removes it ({ removed: true }); one that is not there is not an error ({ removed: false }) and writes nothing', () => {
    const b = bundleOf({ itemGroupings: [grouping('g1', 'tasks', 'asset', ['A1'])] })
    const { routes, writes } = mounted(b)
    expect(call(routes, 'DELETE', GID, { groupingId: 'g1' }).body).toEqual({ ok: true, removed: true })
    expect(b.itemGroupings).toEqual([])
    expect(call(routes, 'DELETE', GID, { groupingId: 'g1' }).body).toEqual({ ok: true, removed: false })
    expect(writes).toHaveLength(1)
  })
})

describe('touch: false — a saved view is not a change to the project', () => {
  it('every write the module makes is { touch: false }: the project\'s updated_at stays, the _DATABASES mirrors are not rewritten', () => {
    const b = bundleOf({ itemGroupings: [grouping('g1', 'tasks', 'asset', ['A1'])] })
    const { routes, log } = mounted(b)
    call(routes, 'POST', V, {}, { id: 'v1', table_key: 'tasks', name: 'One' })
    call(routes, 'POST', V, {}, { id: 'v2', table_key: 'tasks', name: 'Two' })
    call(routes, 'PATCH', VID, { viewId: 'v1' }, { config: { version: 1, a: 1 } })
    call(routes, 'POST', `${V}/reorder`, {}, { table_key: 'tasks', ids: ['v2'] })
    call(routes, 'DELETE', VID, { viewId: 'v1' })
    call(routes, 'POST', G, {}, { table_key: 'tasks', kind: 'scene', entity_ids: ['S1'] })
    call(routes, 'DELETE', GID, { groupingId: 'g1' })
    expect(log.opts).toHaveLength(7)
    expect(log.opts.every(o => o && o.touch === false)).toBe(true)
    expect(log.disk.map(d => d.project.updated_at)).toEqual(Array(7).fill(OLD))
    expect(log.mirrors).toEqual([])
  })
  it('FAILING CONTROL: the same writeRabbitBundle, called with the default, stamps updated_at and re-mirrors', () => {
    const log = { disk: [], mirrors: [], opts: [] }
    realWriteRabbitBundle(log)(PID, bundleOf())
    expect(log.disk[0].project.updated_at).not.toBe(OLD)
    expect(log.mirrors).toEqual([PID])
  })
})

describe('the sweep — fn_item_groupings_forget\'s twin (design §5.2)', () => {
  it('a deleted item leaves every grouping naming it: the rest shrink (and take updated_at), the empty and the repeated set go', () => {
    const b = bundleOf({
      itemGroupings: [
        grouping('k1', 'tasks', 'scene', ['S1', 'S2']), // shrinks onto k2's set: goes
        grouping('k2', 'tasks', 'scene', ['S2']),
        grouping('k3', 'assets', 'scene', ['S1', 'S2']), // shrinks: k2 is another table's
        grouping('k4', 'tasks', 'scene', ['S1']), // left empty: goes
        grouping('k5', 'tasks', 'asset', ['A1', 'S1']), // an asset named S1 that is not a row: goes too (A1 stays)
        grouping('k6', 'tasks', 'level', ['L1', 'L2']), // nothing gone: untouched
      ],
    })
    b.scenes = b.scenes.filter(s => s.id !== 'S1')
    const k6 = b.itemGroupings[5]
    expect(tv.forgetGoneItems(b)).toBe(true)
    expect(b.itemGroupings.map(g => `${g.id}:${g.entity_ids.join('|')}`)).toEqual(['k2:S2', 'k3:S2', 'k5:A1', 'k6:L1|L2'])
    expect(b.itemGroupings.find(g => g.id === 'k3').updated_at).not.toBe('2026-10-17T10:00:00.000Z')
    expect(b.itemGroupings[3]).toBe(k6)
    // Converges: nothing dangles, so nothing changes.
    const again = structuredClone(b.itemGroupings)
    expect(tv.forgetGoneItems(b)).toBe(false)
    expect(b.itemGroupings).toEqual(again)
  })
  it('several items gone at once (a scene and its shots), and a kind that is not an item kind is left alone', () => {
    const b = bundleOf({
      itemGroupings: [
        grouping('s1', 'tasks', 'shot', ['H1', 'H2']), grouping('s2', 'tasks', 'shot', ['H1']),
        grouping('odd', 'tasks', 'phase', ['P1']),
      ],
    })
    b.shots = []
    expect(tv.forgetGoneItems(b)).toBe(true)
    expect(b.itemGroupings.map(g => g.id)).toEqual(['odd'])
  })
  it('no groupings, or no array, is no change', () => {
    expect(tv.forgetGoneItems(bundleOf())).toBe(false)
    expect(tv.forgetGoneItems({ project: {} })).toBe(false)
    expect(tv.forgetGoneItems(null)).toBe(false)
  })
  it('runs on every read, so it scales: 2,000 groupings of 100 ids over 5,000 assets, nothing gone, in well under half a second', () => {
    const assets = Array.from({ length: 5000 }, (_, i) => ({ id: `a${i}` }))
    const tables = ['tasks', 'levels', 'experiences']
    const itemGroupings = Array.from({ length: 2000 }, (_, g) =>
      grouping(`g${g}`, tables[g % 3], 'asset', Array.from({ length: 100 }, (_, k) => `a${(g * 7 + k * 13) % 5000}`)))
    const b = bundleOf({ assets, itemGroupings })
    const t0 = performance.now()
    expect(tv.reconcileTableViewsOnRead(b)).toBe(false)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(b.itemGroupings).toBe(itemGroupings) // untouched: not even copied
  })
  it('reconcileTableViewsOnRead gives an old bundle both arrays (dirty), then is a no-op', () => {
    const b = { project: { id: PID }, assets: [] }
    expect(tv.reconcileTableViewsOnRead(b)).toBe(true)
    expect(b).toMatchObject({ tableViews: [], itemGroupings: [] })
    expect(tv.reconcileTableViewsOnRead(b)).toBe(false)
  })
})

// ── main.cjs's generic routes, lifted, with the hooks composed as main.cjs
// composes them (pinned in the last describe) ─────────────────────────────────
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
    () => {}, () => {}, () => 'unused', cascadeSceneOrShotDelete)
  const taskItemHooks = tv.withItemGroupingSweep(rabbitTaskItems.makeTaskItemHooks({ newId: () => 'unused' }))
  register('tasks', 'tasks', null, { sweepDependencies: true, scheduleRow: true, taskItems: taskItemHooks })
  register('scenes', 'scenes', 'scene', { shotListLinks: 'scene', taskItems: taskItemHooks })
  register('shots', 'shots', 'shot', { shotListLinks: 'shot', taskItems: taskItemHooks })
  register('levels', 'levels', 'level', { taskItems: taskItemHooks })
  register('experiences', 'experiences', 'experience', { taskItems: taskItemHooks })
  return { routes, writes }
}
const ENTITY = (e) => `/api/rabbit/projects/:projectId/${e}/:id`

describe('a scene, shot, level or experience deleted through main.cjs\'s generic routes leaves its groupings, in the same write', () => {
  function withGroupings() {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID, scene_id: 'S1' }],
      itemGroupings: [
        grouping('gs', 'tasks', 'scene', ['S1', 'S2']), // shrinks to [S2]
        grouping('gh', 'assets', 'shot', ['H1', 'H2']), // S1's shot H1 goes with it: shrinks to [H2]
        grouping('gh1', 'tasks', 'shot', ['H1']), // left empty: goes
        grouping('gl', 'tasks', 'level', ['L1', 'L2']), grouping('gl2', 'tasks', 'level', ['L2']),
        grouping('gx', 'levels', 'asset', ['A1']), grouping('ge', 'tasks', 'experience', ['X1']),
      ],
    })
    rabbitTaskItems.reconcileTaskItemsOnRead(b, { projectId: PID, now: OLD })
    return b
  }
  it('a scene: its groupings shrink, its shots\' too (0040\'s cascade), the empty one goes — one write, and the task items still go', () => {
    const b = withGroupings()
    const { routes, writes } = generic(b)
    const r = call(routes, 'DELETE', ENTITY('scenes'), { id: 'S1' })
    expect(r.code).toBe(200)
    expect(b.itemGroupings.map(g => `${g.id}:${g.entity_ids.join('|')}`)).toEqual(['gs:S2', 'gh:H2', 'gl:L1|L2', 'gl2:L2', 'gx:A1', 'ge:X1'])
    expect(writes).toHaveLength(1)
    expect(writes[0].itemGroupings.map(g => g.id)).toEqual(['gs', 'gh', 'gl', 'gl2', 'gx', 'ge'])
    expect(b.taskItems.some(i => i.entity_id === 'S1')).toBe(false)
  })
  it('a level: the grouping that shrinks onto another\'s set goes (the collision)', () => {
    const b = withGroupings()
    const { routes } = generic(b)
    call(routes, 'DELETE', ENTITY('levels'), { id: 'L1' })
    expect(b.itemGroupings.map(g => g.id)).toEqual(['gs', 'gh', 'gh1', 'gl2', 'gx', 'ge'])
  })
  it('an experience: the grouping left empty goes', () => {
    const b = withGroupings()
    const { routes } = generic(b)
    call(routes, 'DELETE', ENTITY('experiences'), { id: 'X1' })
    expect(b.itemGroupings.some(g => g.id === 'ge')).toBe(false)
  })
  it('a shot: only the shot\'s groupings move', () => {
    const b = withGroupings()
    const { routes } = generic(b)
    call(routes, 'DELETE', ENTITY('shots'), { id: 'H2' })
    expect(b.itemGroupings.map(g => `${g.id}:${g.entity_ids.join('|')}`)).toEqual(['gs:S1|S2', 'gh:H1', 'gh1:H1', 'gl:L1|L2', 'gl2:L2', 'gx:A1', 'ge:X1'])
  })
  it('FAILING CONTROL: a delete of an item no grouping names, and a task\'s delete, leave every grouping exactly as it was', () => {
    const b = withGroupings()
    b.scenes.push({ id: 'S9' })
    const before = structuredClone(b.itemGroupings)
    const { routes } = generic(b)
    call(routes, 'DELETE', ENTITY('scenes'), { id: 'S9' })
    call(routes, 'DELETE', ENTITY('tasks'), { id: 'T1' })
    expect(b.itemGroupings).toEqual(before)
  })
  it('the wrapper keeps the item hooks\' writes: a task written through the route still gains its items', () => {
    const b = bundleOf()
    const { routes } = generic(b)
    call(routes, 'POST', '/api/rabbit/projects/:projectId/tasks', {}, { id: 'T2', title: 'x', level_id: 'L2' })
    expect(rabbitTaskItems.itemsOfTask(b.taskItems, 'T2').map(i => i.entity_id)).toEqual(['L2'])
  })
})

describe('an asset deleted through main.cjs\'s asset route leaves its groupings (the route lifted and run)', () => {
  function assetRoute(bundle) {
    const writes = []
    const body = extractRouteBody(MAIN_CJS, "expressApp.delete('/api/rabbit/projects/:projectId/assets/:id',")
    // eslint-disable-next-line no-new-func
    const handler = new Function(
      'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'resolveProjectFolderRoot', 'fileSlugify',
      'resolveContainedFilePath', 'path', 'fs', 'rabbitTableViews', 'rabbitTaskItems',
      `${extractFunction(MAIN_CJS, 'rabbitRemoveFrom')}\nreturn (req, res) => ${body}`,
    )(() => bundle, (_id, b) => { writes.push(structuredClone(b)) },
      (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
      () => null, (s) => s, () => null, path, null, tv, rabbitTaskItems)
    return { writes, del: (id) => { const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }; handler({ params: { projectId: PID, id }, body: {}, query: {} }, res); return res } }
  }
  it('the asset leaves every grouping naming it (the collision and the empty one go), and its tasks keep their other items', () => {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID, asset_id: 'A1' }],
      itemGroupings: [
        grouping('a1', 'levels', 'asset', ['A1', 'A2']), grouping('a2', 'levels', 'asset', ['A2']),
        grouping('a3', 'experiences', 'asset', ['A1', 'A3']), grouping('a4', 'tasks', 'asset', ['A1']),
        grouping('a5', 'tasks', 'scene', ['S1']),
      ],
    })
    rabbitTaskItems.reconcileTaskItemsOnRead(b, { projectId: PID, now: OLD })
    const { del, writes } = assetRoute(b)
    expect(del('A1').body).toEqual({ ok: true })
    expect(b.itemGroupings.map(g => `${g.id}:${g.entity_ids.join('|')}`)).toEqual(['a2:A2', 'a3:A3', 'a5:S1'])
    expect(writes).toHaveLength(1)
    expect(writes[0].itemGroupings.map(g => g.id)).toEqual(['a2', 'a3', 'a5'])
    expect(b.tasks.map(t => t.id)).toEqual(['T1'])
    expect(b.taskItems).toEqual([])
  })
})

describe('readRabbitBundle (lifted from main.cjs) reconciles the views on every read, and persists it once', () => {
  function replayRead(initial) {
    const files = new Map([['/fake/p1/project.json', JSON.stringify(initial)]])
    const diskWrites = []
    // eslint-disable-next-line no-new-func
    const read = new Function(
      'rabbitBundlePath', 'readJSON', 'writeJSON', 'fileSlugify', 'localDemoRootDir', 'isPathInside', 'fs', 'path',
      'localDemoProjectsDir', 'rabbitLogFileEvent', 'ensureProjectFolders', 'ensureProjectFolderRows',
      'materializeFolderDirs', 'uuidv4', 'backfillShotListsOnRead', 'ensureShotListKeys',
      'pruneDanglingShotListItems', 'mirrorProjectDatabases', 'rabbitTaskItems', 'rabbitTableViews',
      `${extractFunction(MAIN_CJS, 'readRabbitBundle')}
       return readRabbitBundle;`,
    )(
      (id) => `/fake/${id}/project.json`,
      (file, fallback) => (files.has(file) ? JSON.parse(files.get(file)) : fallback),
      (file, data) => { files.set(file, JSON.stringify(data)); diskWrites.push(file) },
      (s) => s, () => null, () => false, { existsSync: () => false }, path,
      () => '/fake/projects', () => {}, () => {}, () => false, () => {},
      () => 'unused', backfillShotListsOnRead, ensureShotListKeys, pruneDanglingShotListItems, () => {},
      rabbitTaskItems, tv,
    )
    return { read, diskWrites, files }
  }
  // Everything else a read reconciles is already in step (legalLabelsSettled
  // included), so a write can only be the views'.
  const CURRENT = () => ({
    project: { id: 'p1', title: 'P' },
    projectTeam: [], managedFiles: [], budgetLines: [], budgetActuals: [], budgetVersions: [], expenses: [],
    assets: [{ id: 'A1' }], scenes: [{ id: 'S1' }], shots: [], levels: [], experiences: [], fileEvents: [], folders: [],
    shotLists: [], shotListItems: [], edits: [], tasks: [], taskItems: [],
    legalLabelsSettled: { at: OLD, stripped: [] },
  })

  it('a bundle from before views gains both arrays, written once; the next read writes nothing', () => {
    const { read, diskWrites, files } = replayRead(CURRENT())
    const first = read('p1')
    expect(first).toMatchObject({ tableViews: [], itemGroupings: [] })
    expect(diskWrites).toHaveLength(1)
    expect(JSON.parse(files.get('/fake/p1/project.json'))).toMatchObject({ tableViews: [], itemGroupings: [] })
    read('p1')
    expect(diskWrites).toHaveLength(1)
  })
  it('FAILING CONTROL: a current bundle with both arrays and nothing dangling is not rewritten', () => {
    const { read, diskWrites } = replayRead({ ...CURRENT(), tableViews: [], itemGroupings: [grouping('g', 'tasks', 'asset', ['A1'])] })
    read('p1')
    expect(diskWrites).toHaveLength(0)
  })
  it('a grouping naming an item an older build deleted loses it on read, persisted once', () => {
    const { read, diskWrites, files } = replayRead({
      ...CURRENT(), tableViews: [],
      itemGroupings: [grouping('g1', 'tasks', 'scene', ['S1', 'S-GONE']), grouping('g2', 'tasks', 'asset', ['A-GONE'])],
    })
    expect(read('p1').itemGroupings.map(g => `${g.id}:${g.entity_ids.join('|')}`)).toEqual(['g1:S1'])
    expect(diskWrites).toHaveLength(1)
    expect(JSON.parse(files.get('/fake/p1/project.json')).itemGroupings.map(g => g.id)).toEqual(['g1'])
    read('p1')
    expect(diskWrites).toHaveLength(1)
  })
})

describe('this machine\'s last used view — <data folder>/rabbit-machine-settings.json', () => {
  const KEY = `${UUID}:tasks`
  it('GET answers {} when there is no file, and when the file holds something else', () => {
    expect(call(mounted(bundleOf()).routes, 'GET', M).body).toEqual({ tableViewLast: {} })
    for (const junk of ['[1,2]', '"x"', 'null', '{"tableViewLast":[1]}']) {
      const files = new Map([[SETTINGS, junk]])
      expect(call(mounted(bundleOf(), files).routes, 'GET', M).body, junk).toEqual({ tableViewLast: {} })
    }
  })
  it('POST merges one key with this machine\'s clock, keeps every other key in the file, and answers the map', () => {
    const files = new Map([[SETTINGS, JSON.stringify({ somethingElse: { keep: true }, tableViewLast: { [`${UUID}:assets`]: { view: 'all', at: 5 } } })]])
    const { routes } = mounted(bundleOf(), files)
    const t0 = Date.now()
    const r = call(routes, 'POST', ML, {}, { key: KEY, view: 'v-1' })
    const t1 = Date.now()
    expect(r.code).toBe(200)
    expect(Object.keys(r.body.tableViewLast).sort()).toEqual([`${UUID}:assets`, KEY])
    expect(r.body.tableViewLast[KEY].view).toBe('v-1')
    expect(r.body.tableViewLast[KEY].at).toBeGreaterThanOrEqual(t0)
    expect(r.body.tableViewLast[KEY].at).toBeLessThanOrEqual(t1)
    const disk = JSON.parse(files.get(SETTINGS))
    expect(disk.somethingElse).toEqual({ keep: true })
    expect(disk.tableViewLast).toEqual(r.body.tableViewLast)
    expect(call(routes, 'GET', M).body).toEqual({ tableViewLast: r.body.tableViewLast })
  })
  it('two keys written one after the other are both kept (each write merges its one key into what is there)', () => {
    const { routes, files } = mounted(bundleOf())
    call(routes, 'POST', ML, {}, { key: KEY, view: 'all' })
    call(routes, 'POST', ML, {}, { key: `${UUID}:shots`, view: 'v-2' })
    const map = JSON.parse(files.get(SETTINGS)).tableViewLast
    expect(Object.keys(map).sort()).toEqual([KEY, `${UUID}:shots`].sort())
    expect(map[KEY].view).toBe('all')
    expect(map[`${UUID}:shots`].view).toBe('v-2')
  })
  it('keeps the 300 newest: the oldest goes, the new key stays', () => {
    const tableViewLast = {}
    for (let i = 0; i < 300; i++) tableViewLast[`p${String(i).padStart(3, '0')}:tasks`] = { view: 'all', at: i + 1 }
    const files = new Map([[SETTINGS, JSON.stringify({ tableViewLast })]])
    const { routes } = mounted(bundleOf(), files)
    const map = call(routes, 'POST', ML, {}, { key: KEY, view: 'all' }).body.tableViewLast
    expect(Object.keys(map)).toHaveLength(300)
    expect(map).toHaveProperty([KEY])
    expect(map).not.toHaveProperty(['p000:tasks'])
    expect(map).toHaveProperty(['p001:tasks'])
  })
  it('refuses a key that is not a project id and a table, and a view that is not an id or "all" (400 table_view_last_invalid); nothing written', () => {
    const { routes, files } = mounted(bundleOf())
    for (const body of [{ key: 'tasks', view: 'all' }, { key: `${UUID}:milestones`, view: 'all' }, { key: 7, view: 'all' },
      { key: KEY, view: '' }, { key: KEY, view: 'a b' }, { key: KEY, view: null }, { key: KEY }]) {
      expect(call(routes, 'POST', ML, {}, body), JSON.stringify(body)).toMatchObject({ code: 400, body: { code: 'table_view_last_invalid' } })
    }
    expect(files.has(SETTINGS)).toBe(false)
  })
})

describe('main.cjs wires the module in', () => {
  it('requires it, mounts it beside the task items (after the /api/rabbit guard, before the static / SPA fallback), with getDataDir', () => {
    expect(MAIN_CJS).toMatch(/const rabbitTableViews = require\('\.\/rabbitTableViews\.cjs'\);/)
    const mount = MAIN_CJS.indexOf('rabbitTableViews.mountRabbitTableViews(expressApp, {')
    expect(mount).toBeGreaterThan(MAIN_CJS.indexOf('rabbitTaskItems.mountRabbitTaskItems(expressApp, {'))
    expect(mount).toBeGreaterThan(MAIN_CJS.indexOf("expressApp.use('/api/rabbit', localDemoMissingGuard)"))
    expect(MAIN_CJS.indexOf('express.static(distPath)')).toBeGreaterThan(mount)
    expect(MAIN_CJS.indexOf("expressApp.get('/{*splat}'")).toBeGreaterThan(mount)
    expect(MAIN_CJS.slice(mount, MAIN_CJS.indexOf('});', mount)))
      .toMatch(/readRabbitBundle, writeRabbitBundle, rabbitNotFound, uuidv4, getDataDir, readJSON, writeJSON/)
  })
  it('the empty bundle has both keys; every read reconciles them', () => {
    expect(extractFunction(MAIN_CJS, 'emptyBundle')).toMatch(/\btableViews:\s*\[\]/)
    expect(extractFunction(MAIN_CJS, 'emptyBundle')).toMatch(/\bitemGroupings:\s*\[\]/)
    expect(extractFunction(MAIN_CJS, 'readRabbitBundle')).toMatch(/rabbitTableViews\.reconcileTableViewsOnRead\(bundle\)\) dirty = true;/)
  })
  it('the generic routes\' item hooks are wrapped with the sweep, and the asset DELETE route sweeps before its write', () => {
    expect(MAIN_CJS).toMatch(/const taskItemHooks = rabbitTableViews\.withItemGroupingSweep\(rabbitTaskItems\.makeTaskItemHooks\(\{ newId: uuidv4 \}\)\);/)
    for (const e of ['scenes', 'shots', 'levels', 'experiences']) {
      expect(MAIN_CJS, e).toMatch(new RegExp(`rabbitSubentityRoutes\\(\\s*'${e}',[^\\n]*taskItems:\\s*taskItemHooks`))
    }
    const start = MAIN_CJS.indexOf("expressApp.delete('/api/rabbit/projects/:projectId/assets/:id'")
    const body = MAIN_CJS.slice(start, MAIN_CJS.indexOf('res.json({ ok: true });', start))
    expect(body).toMatch(/rabbitRemoveFrom\(bundle\.assets, req\.params\.id\);[\s\S]*rabbitTableViews\.forgetGoneItems\(bundle\);[\s\S]*writeRabbitBundle/)
  })
  it('views and groupings stay out of the readable mirrors (mirrorProjectDatabases, timeline.json)', () => {
    const mirror = extractFunction(MAIN_CJS, 'mirrorProjectDatabases')
    expect(mirror).not.toMatch(/tableViews|itemGroupings|tableViewRevision/)
  })
})
