// =============================================================================
// rabbitShotLists.routes.test.js — post-overhaul S3a (0084), the Local Server.
//
// A real Express app on an ephemeral port and the real
// electron/rabbitShotLists.cjs (the rabbitBins.routes.test.js pattern), over a
// fake bundle store with DISK semantics — read = parse a copy, write = store —
// so a route that mutates without writing, or writes before it has finished
// validating, is caught exactly as it would be on the desktop. The helpers
// the module is handed (rabbitTouch, rabbitUpsertInto, rabbitNotFound) are
// LIFTED from electron/main.cjs, so the routes run with the shipped ones.
//
// Every rule of the S3a contract, 1–9, with the failing control that proves
// each assertion can fail:
//   1 upsertShotList · 2 replaceShotListItems · 3 upsertEdit
//   4 setActiveShotList · 5 archiveShotList · 6 archiveEdit
//   7 the project PATCH refuses a change to active_shot_list_id (main.cjs —
//     that handler is lifted and replayed below)
//   8 the scene / shot delete sweep (sweepShotListLinks; also replayed through
//     the factory in desktopDeleteSweep.test.js)
//   9 the read-time backfill (the pure functions, and readRabbitBundle lifted
//     from main.cjs to prove the hook persists it exactly once)
// Messages are typed out here, not imported, so a changed message fails.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const {
  mountRabbitShotLists, ensureShotListKeys, backfillShotListsOnRead, sweepShotListLinks,
} = require('../../../../electron/rabbitShotLists.cjs')
const MAIN_CJS = readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf-8')

/** Lift `function name(...) { ... }` out of main.cjs (desktopDeleteSweep.test.js's technique). */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — the replay cannot run`)
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
  throw new Error(`unbalanced braces extracting ${name}() from main.cjs`)
}

/** Lift the BODY block of an inline `expressApp.<verb>('<path>', (req, res) => { … })`. */
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

// ── the fakes ────────────────────────────────────────────────────────────────
let seq = 0
const uuidv4 = () => `id-${String(++seq).padStart(4, '0')}`
// eslint-disable-next-line no-new-func
const { rabbitTouch, rabbitUpsertInto, rabbitNotFound } = new Function('uuidv4', `
  ${extractFunction(MAIN_CJS, 'rabbitTouch')}
  ${extractFunction(MAIN_CJS, 'rabbitUpsertInto')}
  ${extractFunction(MAIN_CJS, 'rabbitNotFound')}
  return { rabbitTouch, rabbitUpsertInto, rabbitNotFound };`)(uuidv4)

const store = new Map()
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
let writes = []
const writeRabbitBundle = (id, bundle, opts) => {
  store.set(id, JSON.stringify(bundle))
  writes.push({ id, touch: opts?.touch !== false })
}
const DEPS = () => ({ readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitNotFound, uuidv4 })

const PID = 'p1'
let server, base

beforeAll(async () => {
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitShotLists(app, DEPS())
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => { store.clear(); writes = []; seq = 0 })

const T0 = '2026-09-01T10:00:00.000Z'
function list(id, extra = {}) {
  return {
    id, project_id: PID, workspace_id: null, title: 'Shot list', version: 1, summary: null, snapshot: {},
    archived_at: null, archived_by: null, created_at: T0, created_by: null, updated_at: T0, updated_by: null, ...extra,
  }
}
function item(id, listId, ref, position = 0) {
  return {
    id, shot_list_id: listId, project_id: PID, workspace_id: null,
    scene_id: ref.scene || null, shot_id: ref.shot || null, position,
    created_at: T0, created_by: null, updated_at: T0, updated_by: null,
  }
}
function edit(id, listId, extra = {}) {
  return {
    id, project_id: PID, workspace_id: null, shot_list_id: listId, title: 'Cut', version: 1, summary: null,
    parent_edit_id: null, items: [], snapshot: null, archived_at: null, archived_by: null,
    created_at: T0, created_by: null, updated_at: T0, updated_by: null, ...extra,
  }
}
/** A post-S3a bundle: the three keys exist (so no backfill), two scenes, three shots. */
function seed(extra = {}) {
  const b = {
    project: { id: PID, title: 'Shot lists', active_shot_list_id: null },
    scenes: [{ id: 'sc-1', scene_number: 1 }, { id: 'sc-2', scene_number: 2 }],
    shots: [
      { id: 'sh-1', scene_id: 'sc-1', shot_number: 1 },
      { id: 'sh-2', scene_id: 'sc-1', shot_number: 2 },
      { id: 'sh-3', scene_id: null, shot_number: 1 },
    ],
    tasks: [],
    shotLists: [], shotListItems: [], edits: [],
    ...extra,
  }
  store.set(PID, JSON.stringify(b))
  return b
}
const disk = () => JSON.parse(store.get(PID))
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function api(p, init) {
  const r = await fetch(`${base}/api/rabbit/projects/${PID}${p}`, init)
  let body = null
  try { body = await r.json() } catch { /* no body */ }
  return { status: r.status, body }
}
const POST = (p, body) => api(p, send('POST', body))
const PUT = (p, body) => api(p, send('PUT', body))
const refused = (r, status, code, error) => {
  expect(r.status).toBe(status)
  expect(r.body).toEqual({ error, code })
}

const LIST_KEYS = ['archived_at', 'archived_by', 'created_at', 'created_by', 'id', 'project_id', 'snapshot', 'summary',
  'title', 'updated_at', 'updated_by', 'version', 'workspace_id']
const ITEM_KEYS = ['created_at', 'created_by', 'id', 'position', 'project_id', 'scene_id', 'shot_id', 'shot_list_id',
  'updated_at', 'updated_by', 'workspace_id']
const EDIT_KEYS = ['archived_at', 'archived_by', 'created_at', 'created_by', 'id', 'items', 'parent_edit_id', 'project_id',
  'shot_list_id', 'snapshot', 'summary', 'title', 'updated_at', 'updated_by', 'version', 'workspace_id']

// ── the mount ────────────────────────────────────────────────────────────────
describe('mountRabbitShotLists', () => {
  it('throws when a required helper is missing, naming it', () => {
    for (const k of ['readRabbitBundle', 'writeRabbitBundle', 'rabbitTouch', 'rabbitUpsertInto', 'rabbitNotFound']) {
      const deps = DEPS()
      delete deps[k]
      expect(() => mountRabbitShotLists(express(), deps)).toThrow(`missing helper ${k}`)
    }
    const deps = DEPS()
    delete deps.uuidv4
    expect(() => mountRabbitShotLists(express(), deps)).toThrow(/uuidv4/)
  })

  it('CONTROL: complete helpers mount, and newId stands in for uuidv4', () => {
    expect(() => mountRabbitShotLists(express(), DEPS())).not.toThrow()
    const deps = DEPS()
    delete deps.uuidv4
    deps.newId = uuidv4
    expect(() => mountRabbitShotLists(express(), deps)).not.toThrow()
  })

  it('an unknown project is a 404 on every route', async () => {
    const r = await fetch(`${base}/api/rabbit/projects/nope/shot-lists`, send('POST', { title: 'x' }))
    expect(r.status).toBe(404)
    expect(writes).toEqual([])
  })

  it('registers no DELETE for lists or edits (D4/D18)', async () => {
    seed({ shotLists: [list('L1')], edits: [edit('e1', 'L1')] })
    expect((await api('/shot-lists/L1', { method: 'DELETE' })).status).toBe(404)
    expect((await api('/edits/e1', { method: 'DELETE' })).status).toBe(404)
    expect(disk().shotLists).toHaveLength(1)
    expect(disk().edits).toHaveLength(1)
  })
})

// ── rule 1 ───────────────────────────────────────────────────────────────────
describe('rule 1 — upsertShotList', () => {
  it('creates a row of exactly the contract shape, project_id from the URL, v1 by default', async () => {
    seed()
    const r = await POST('/shot-lists', { title: 'Pickups', project_id: 'another-project', bogus: 1, workspace_id: 'ws', created_by: 'u1' })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(LIST_KEYS)
    expect(r.body).toMatchObject({
      project_id: PID, workspace_id: null, title: 'Pickups', version: 1, summary: null, snapshot: {},
      archived_at: null, archived_by: null, created_by: null, updated_by: null,
    })
    expect(disk().shotLists).toEqual([r.body])
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('keeps a body id and a body created_at on a NEW row (a redo re-sends both)', async () => {
    seed()
    const r = await POST('/shot-lists', { id: 'L-redo', title: 'A', version: 2, created_at: T0 })
    expect(r.body).toMatchObject({ id: 'L-redo', created_at: T0, version: 2 })
  })

  it('a blank or missing title is 400 invalid, and nothing is written', async () => {
    seed()
    for (const body of [{}, { title: '' }, { title: '   ' }, { title: 7 }]) {
      refused(await POST('/shot-lists', body), 400, 'invalid', 'A shot list needs a title.')
    }
    expect(writes).toEqual([])
  })

  it('a version that is not a whole number of at least 1 is 400 invalid', async () => {
    seed()
    for (const version of [0, -1, 1.5, '2', null]) {
      refused(await POST('/shot-lists', { title: 'A', version }), 400, 'invalid',
        'A shot list\'s version must be a whole number of at least 1.')
    }
    expect(writes).toEqual([])
    // CONTROL
    expect((await POST('/shot-lists', { title: 'A', version: 3 })).status).toBe(200)
  })

  it('title (trimmed) + version is unique per project, archived or not — 409 conflict', async () => {
    seed({ shotLists: [list('L1', { title: 'Pickups', version: 1, archived_at: T0 })] })
    refused(await POST('/shot-lists', { title: '  Pickups ', version: 1 }), 409, 'conflict',
      'There is already a shot list called "Pickups · v1".')
    expect(writes).toEqual([])
    // CONTROLS: another version is free, and a list never clashes with itself.
    expect((await POST('/shot-lists', { title: 'Pickups', version: 2 })).status).toBe(200)
    seed({ shotLists: [list('L1', { title: 'Pickups', version: 1 })] })
    expect((await POST('/shot-lists', { id: 'L1', title: 'Pickups', version: 1, summary: 'x' })).status).toBe(200)
  })

  it('a snapshot that is not a plain object is 400 invalid; an update without one keeps the stored one', async () => {
    seed({ shotLists: [list('L1', { snapshot: { kind: 'shot_list', saved_at: T0 } })] })
    for (const snapshot of [[], 'x', null, 3]) {
      refused(await POST('/shot-lists', { title: 'A', snapshot }), 400, 'invalid', 'A shot list\'s snapshot must be an object.')
    }
    expect(writes).toEqual([])
    const r = await POST('/shot-lists', { id: 'L1', summary: 'retitled nothing' })
    expect(r.status).toBe(200)
    expect(r.body.snapshot).toEqual({ kind: 'shot_list', saved_at: T0 })
    expect(r.body.title).toBe('Shot list') // a partial body merges over the stored row
  })

  it('an update keeps created_at and project_id, and moves updated_at', async () => {
    seed({ shotLists: [list('L1')] })
    const r = await POST('/shot-lists', { id: 'L1', title: 'Renamed', version: 4, project_id: 'elsewhere', created_at: '1999-01-01T00:00:00.000Z' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: 'L1', title: 'Renamed', version: 4, project_id: PID, created_at: T0 })
    expect(r.body.updated_at).not.toBe(T0)
    expect(disk().shotLists).toHaveLength(1)
  })

  it('an ARCHIVED row cannot be changed — 409 conflict, disk unchanged', async () => {
    const b = seed({ shotLists: [list('L1', { archived_at: T0 })] })
    // The whole row echoed back (archive columns unchanged), so this is the
    // archived-row refusal and not the archive-column one.
    refused(await POST('/shot-lists', { ...b.shotLists[0], title: 'Changed' }), 409, 'conflict',
      'this shot list is archived — restore it before changing it')
    expect(disk().shotLists).toEqual(b.shotLists)
    expect(writes).toEqual([])
  })

  it('a change to archived_at / archived_by — or a NEW row arriving archived — is 403 forbidden', async () => {
    const MSG = 'shot lists are archived and restored only by a project manager or a workspace admin, through archive_shot_list()'
    const b = seed({ shotLists: [list('L1'), list('L2', { title: 'Old', archived_at: T0 })] })
    refused(await POST('/shot-lists', { id: 'L1', archived_at: T0 }), 403, 'forbidden', MSG)
    refused(await POST('/shot-lists', { id: 'L1', archived_by: 'u1' }), 403, 'forbidden', MSG)
    refused(await POST('/shot-lists', { id: 'L2', archived_at: null }), 403, 'forbidden', MSG) // restore by upsert
    refused(await POST('/shot-lists', { title: 'New', archived_at: T0 }), 403, 'forbidden', MSG)
    expect(disk().shotLists).toEqual(b.shotLists)
    expect(writes).toEqual([])
    // CONTROL: the live row echoed whole, archive columns unchanged, passes.
    expect((await POST('/shot-lists', { ...b.shotLists[0], summary: 'ok' })).status).toBe(200)
  })
})

// ── rule 2 ───────────────────────────────────────────────────────────────────
describe('rule 2 — replaceShotListItems', () => {
  function seedItems() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }, 0),
        item('i2', 'L1', { shot: 'sh-1' }, 0),
        item('j1', 'L2', { scene: 'sc-1' }, 0),
      ],
    })
  }

  it('a list that is not in this project is 404 not_found', async () => {
    seedItems()
    refused(await PUT('/shot-lists/L-nope/items', { items: [] }), 404, 'not_found', 'shot list not found')
  })

  it('items that are not an array are 400 invalid', async () => {
    seedItems()
    for (const body of [{}, { items: {} }, { items: 'x' }, { items: null }]) {
      refused(await PUT('/shot-lists/L1/items', body), 400, 'invalid', 'items must be a JSON array')
    }
    expect(writes).toEqual([])
  })

  it('an item must name exactly one scene or one shot', async () => {
    seedItems()
    for (const bad of [{ scene_id: 'sc-1', shot_id: 'sh-1' }, {}, { scene_id: '', shot_id: '' }, null, 'sc-1']) {
      refused(await PUT('/shot-lists/L1/items', { items: [bad] }), 400, 'invalid', 'each item names exactly one scene or one shot')
    }
    expect(writes).toEqual([])
  })

  it('FAILING CONTROL: a foreign scene id is refused AND the stored set is unchanged', async () => {
    const b = seedItems()
    refused(await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2' }, { scene_id: 'sc-of-another-project' }] }),
      400, 'invalid', 'an item names a scene or shot that is not in this project')
    refused(await PUT('/shot-lists/L1/items', { items: [{ shot_id: 'sh-elsewhere' }] }),
      400, 'invalid', 'an item names a scene or shot that is not in this project')
    expect(disk().shotListItems).toEqual(b.shotListItems)
    expect(writes).toEqual([])
    // The same payload with a real scene is written — the refusal above was the id.
    expect((await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2' }, { scene_id: 'sc-1' }] })).status).toBe(200)
  })

  it('the same scene or shot twice is 409 conflict', async () => {
    seedItems()
    refused(await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-1' }, { scene_id: 'sc-1', position: 3 }] }),
      409, 'conflict', 'a shot list holds each scene and each shot once')
    refused(await PUT('/shot-lists/L1/items', { items: [{ shot_id: 'sh-2' }, { id: 'i2', shot_id: 'sh-2' }] }),
      409, 'conflict', 'a shot list holds each scene and each shot once')
    expect(writes).toEqual([])
  })

  it('a position must be a whole number of at least 0; a missing one is the item\'s index', async () => {
    seedItems()
    for (const position of [-1, 1.5, '2', true]) {
      refused(await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-1', position }] }), 400, 'invalid',
        'an item\'s position must be a whole number of at least 0')
    }
    expect(writes).toEqual([])
    const r = await PUT('/shot-lists/L1/items', { items: [{ shot_id: 'sh-3' }, { scene_id: 'sc-2', position: null }, { scene_id: 'sc-1', position: 7 }] })
    expect(r.status).toBe(200)
    const pos = Object.fromEntries(r.body.map(i => [i.scene_id || i.shot_id, i.position]))
    expect(pos).toEqual({ 'sh-3': 0, 'sc-2': 1, 'sc-1': 7 })
  })

  it('ids: an own id keeps its row, an unknown id is inserted as given, no id mints one, another list\'s id is SKIPPED', async () => {
    seedItems()
    const r = await PUT('/shot-lists/L1/items', { items: [
      { id: 'i1', scene_id: 'sc-2', position: 1 }, // re-pointed and moved, same row
      { id: 'new-1', scene_id: 'sc-1', position: 0 }, // inserted with that id
      { shot_id: 'sh-2', position: 0 }, // minted id
      { id: 'j1', shot_id: 'sh-3', position: 0 }, // L2's item id: skipped
    ] })
    expect(r.status).toBe(200)
    // Ordered position, then id; the skipped item is not returned.
    expect(r.body.map(i => i.id)).toEqual(['id-0001', 'new-1', 'i1'])
    for (const row of r.body) expect(Object.keys(row).sort()).toEqual(ITEM_KEYS)
    const i1 = r.body.find(i => i.id === 'i1')
    expect(i1).toMatchObject({ scene_id: 'sc-2', shot_id: null, position: 1, created_at: T0, shot_list_id: 'L1' })
    expect(i1.updated_at).not.toBe(T0)
    expect(r.body.find(i => i.id === 'id-0001')).toMatchObject({ shot_id: 'sh-2', scene_id: null, project_id: PID, workspace_id: null })
    const d = disk()
    // i2 was not named: gone. L2's j1 is untouched, and no sh-3 item was written anywhere.
    expect(d.shotListItems.filter(i => i.shot_list_id === 'L1').map(i => i.id).sort()).toEqual(['i1', 'id-0001', 'new-1'])
    expect(d.shotListItems.find(i => i.id === 'j1')).toEqual(item('j1', 'L2', { scene: 'sc-1' }, 0))
    expect(d.shotListItems.some(i => i.shot_id === 'sh-3')).toBe(false)
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('an empty array empties the list — and only that list', async () => {
    seedItems()
    const r = await PUT('/shot-lists/L1/items', { items: [] })
    expect(r.body).toEqual([])
    expect(disk().shotListItems.map(i => i.id)).toEqual(['j1'])
  })

  it('all-or-nothing: one bad item after three good ones writes nothing', async () => {
    const b = seedItems()
    refused(await PUT('/shot-lists/L1/items', { items: [
      { scene_id: 'sc-1' }, { scene_id: 'sc-2' }, { shot_id: 'sh-1' }, { shot_id: 'sh-2', position: -4 },
    ] }), 400, 'invalid', 'an item\'s position must be a whole number of at least 0')
    expect(disk()).toEqual(b)
    expect(writes).toEqual([])
  })

  it('the same item id twice is refused by name', async () => {
    seedItems()
    refused(await PUT('/shot-lists/L1/items', { items: [{ id: 'i1', scene_id: 'sc-1' }, { id: 'i1', scene_id: 'sc-2' }] }),
      400, 'invalid', 'an item id appears more than once')
    expect(writes).toEqual([])
  })

  it('an ARCHIVED list is not frozen here (the database does not freeze it either)', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0 })] })
    const r = await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-1' }] })
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1)
  })
})

// ── rule 3 ───────────────────────────────────────────────────────────────────
describe('rule 3 — upsertEdit', () => {
  function seedEdits() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      edits: [edit('e1', 'L1'), edit('e2', 'L2')],
    })
  }

  it('creates a row of exactly the contract shape: items [] and snapshot null by default', async () => {
    seedEdits()
    const r = await POST('/edits', { shot_list_id: 'L1', title: 'Assembly', project_id: 'elsewhere', bogus: true })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(EDIT_KEYS)
    expect(r.body).toMatchObject({
      project_id: PID, workspace_id: null, shot_list_id: 'L1', title: 'Assembly', version: 1, items: [],
      snapshot: null, parent_edit_id: null, archived_at: null, archived_by: null,
    })
    expect(disk().edits).toHaveLength(3)
  })

  it('stores items as sent (D6: repeats allowed)', async () => {
    seedEdits()
    const items = [
      { id: 'x1', scene_id: 'sc-1', shot_id: 'sh-1', label: 'A', notes: '' },
      { id: 'x2', scene_id: 'sc-1', shot_id: 'sh-1', label: 'A again', notes: 'repeat' },
    ]
    const r = await POST('/edits', { shot_list_id: 'L1', title: 'Rough', items })
    expect(r.body.items).toEqual(items)
  })

  it('a blank title or a bad version is 400 invalid', async () => {
    seedEdits()
    refused(await POST('/edits', { shot_list_id: 'L1', title: ' ' }), 400, 'invalid', 'An edit needs a title.')
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', version: 0 }), 400, 'invalid',
      'An edit\'s version must be a whole number of at least 1.')
    expect(writes).toEqual([])
  })

  it('an edit belongs to a shot list of this project', async () => {
    seedEdits()
    for (const shot_list_id of [undefined, null, 'L-nope']) {
      refused(await POST('/edits', { shot_list_id, title: 'A' }), 400, 'invalid', 'an edit belongs to a shot list of this project')
    }
    expect(writes).toEqual([])
  })

  it('(list, title trimmed, version) is unique — 409; the same label on ANOTHER list is fine', async () => {
    seedEdits()
    refused(await POST('/edits', { shot_list_id: 'L1', title: ' Cut ', version: 1 }), 409, 'conflict',
      'This shot list already has an edit called "Cut · v1".')
    expect(writes).toEqual([])
    // CONTROLS: e2 is "Cut · v1" on L2 already; v2 on L1 is free.
    expect((await POST('/edits', { shot_list_id: 'L1', title: 'Cut', version: 2 })).status).toBe(200)
  })

  it('items must be a list; a snapshot must be an object or null', async () => {
    seedEdits()
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', items: {} }), 400, 'invalid', 'An edit\'s items must be a list.')
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', items: null }), 400, 'invalid', 'An edit\'s items must be a list.')
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', snapshot: [] }), 400, 'invalid', 'An edit\'s snapshot must be an object.')
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', snapshot: 'x' }), 400, 'invalid', 'An edit\'s snapshot must be an object.')
    expect(writes).toEqual([])
    expect((await POST('/edits', { shot_list_id: 'L1', title: 'A', snapshot: null })).status).toBe(200)
    expect((await POST('/edits', { shot_list_id: 'L1', title: 'B', snapshot: { kind: 'edit' } })).body.snapshot).toEqual({ kind: 'edit' })
  })

  it('the parent is ANOTHER edit of the SAME list (D6: one linear chain per list)', async () => {
    seedEdits()
    const MSG = 'an edit\'s parent must be another edit of the same shot list'
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', parent_edit_id: 'e2' }), 400, 'invalid', MSG) // L2's
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', parent_edit_id: 'e-nope' }), 400, 'invalid', MSG)
    refused(await POST('/edits', { id: 'e1', parent_edit_id: 'e1' }), 400, 'invalid', MSG) // its own id
    refused(await POST('/edits', { id: 'e-new', shot_list_id: 'L1', title: 'A', parent_edit_id: 'e-new' }), 400, 'invalid', MSG)
    expect(writes).toEqual([])
    // CONTROL
    const r = await POST('/edits', { shot_list_id: 'L1', title: 'A', parent_edit_id: 'e1' })
    expect(r.status).toBe(200)
    expect(r.body.parent_edit_id).toBe('e1')
  })

  it('an update keeps created_at; a stored edit cannot move lists (403) — an echo of its list passes', async () => {
    seedEdits()
    refused(await POST('/edits', { id: 'e1', shot_list_id: 'L2' }), 403, 'forbidden', 'an edit cannot move to another shot list')
    expect(writes).toEqual([])
    const r = await POST('/edits', { id: 'e1', shot_list_id: 'L1', summary: 's', created_at: '1999-01-01T00:00:00.000Z' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: 'e1', shot_list_id: 'L1', summary: 's', created_at: T0 })
  })

  it('archived: changing one is 409; touching the archive columns is 403', async () => {
    const b = seed({ shotLists: [list('L1')], edits: [edit('e1', 'L1'), edit('e2', 'L1', { title: 'Old', archived_at: T0 })] })
    refused(await POST('/edits', { ...b.edits[1], title: 'New' }), 409, 'conflict', 'this edit is archived — restore it before changing it')
    const MSG = 'edits are archived and restored only by a project manager or a workspace admin, through archive_edit()'
    refused(await POST('/edits', { id: 'e1', archived_at: T0 }), 403, 'forbidden', MSG)
    refused(await POST('/edits', { id: 'e2', archived_at: null }), 403, 'forbidden', MSG)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'N', archived_at: T0 }), 403, 'forbidden', MSG)
    expect(disk().edits).toEqual(b.edits)
    expect(writes).toEqual([])
  })
})

// ── rule 4 ───────────────────────────────────────────────────────────────────
describe('rule 4 — setActiveShotList', () => {
  it('sets project.active_shot_list_id and answers it; null clears it', async () => {
    seed({ shotLists: [list('L1')] })
    let r = await POST('/active-shot-list', { listId: 'L1' })
    expect(r).toEqual({ status: 200, body: { active_shot_list_id: 'L1' } })
    expect(disk().project.active_shot_list_id).toBe('L1')
    r = await POST('/active-shot-list', { listId: null })
    expect(r).toEqual({ status: 200, body: { active_shot_list_id: null } })
    expect(disk().project.active_shot_list_id).toBeNull()
  })

  it('a list not in the project is 404; an archived one is 409; neither writes', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0 })] })
    refused(await POST('/active-shot-list', { listId: 'L-nope' }), 404, 'not_found', 'shot list not found in this project')
    refused(await POST('/active-shot-list', { listId: 'L1' }), 409, 'conflict',
      'an archived shot list cannot be made active — restore it first')
    expect(disk().project.active_shot_list_id).toBeNull()
    expect(writes).toEqual([])
  })

  it('a body without listId is refused rather than read as "clear"', async () => {
    seed({ project: { id: PID, title: 'x', active_shot_list_id: 'L1' }, shotLists: [list('L1')] })
    refused(await POST('/active-shot-list', {}), 400, 'invalid', 'listId is required (null clears the active shot list)')
    expect(disk().project.active_shot_list_id).toBe('L1')
  })
})

// ── rule 5 ───────────────────────────────────────────────────────────────────
describe('rule 5 — archiveShotList', () => {
  it('an unknown list is 404', async () => {
    seed()
    refused(await POST('/shot-lists/L-nope/archive', { archived: true }), 404, 'not_found', 'shot list not found')
  })

  it('FAILING CONTROL: the ACTIVE list cannot be archived (409) — a non-active one can', async () => {
    const b = seed({ project: { id: PID, title: 'x', active_shot_list_id: 'L1' }, shotLists: [list('L1'), list('L2', { title: 'B' })] })
    refused(await POST('/shot-lists/L1/archive', { archived: true }), 409, 'conflict',
      'the active shot list cannot be archived — make another list active first')
    refused(await POST('/shot-lists/L1/archive', {}), 409, 'conflict',
      'the active shot list cannot be archived — make another list active first')
    expect(disk().shotLists).toEqual(b.shotLists)
    expect(writes).toEqual([])
    const r = await POST('/shot-lists/L2/archive', { archived: true })
    expect(r.status).toBe(200)
    expect(r.body.archived_at).toBeTruthy()
    expect(r.body.archived_by).toBeNull() // no users on the Local Server
    expect(disk().shotLists.find(l => l.id === 'L2').archived_at).toBe(r.body.archived_at)
  })

  it('is idempotent: a second archive keeps the first archived_at and writes nothing', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0 })] })
    const r = await POST('/shot-lists/L1/archive', { archived: true })
    expect(r.status).toBe(200)
    expect(r.body.archived_at).toBe(T0)
    expect(writes).toEqual([])
  })

  it('archived false restores (both columns null); restoring a live list changes nothing', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0, archived_by: 'someone' }), list('L2', { title: 'B' })] })
    const r = await POST('/shot-lists/L1/archive', { archived: false })
    expect(r.body).toMatchObject({ archived_at: null, archived_by: null })
    expect(disk().shotLists[0]).toMatchObject({ archived_at: null, archived_by: null })
    writes = []
    expect((await POST('/shot-lists/L2/archive', { archived: false })).body).toEqual(list('L2', { title: 'B' }))
    expect(writes).toEqual([])
  })

  it('a restored list can be made active again; while archived it cannot', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0 })] })
    expect((await POST('/active-shot-list', { listId: 'L1' })).status).toBe(409)
    await POST('/shot-lists/L1/archive', { archived: false })
    expect((await POST('/active-shot-list', { listId: 'L1' })).status).toBe(200)
  })

  it('an `archived` that is not a boolean is refused, not guessed', async () => {
    seed({ shotLists: [list('L1')] })
    refused(await POST('/shot-lists/L1/archive', { archived: 'false' }), 400, 'invalid', 'archived must be true or false')
    expect(writes).toEqual([])
  })
})

// ── rule 6 ───────────────────────────────────────────────────────────────────
describe('rule 6 — archiveEdit', () => {
  it('404 for an unknown edit; archive, idempotent re-archive, restore', async () => {
    seed({ project: { id: PID, title: 'x', active_shot_list_id: 'L1' }, shotLists: [list('L1')], edits: [edit('e1', 'L1')] })
    refused(await POST('/edits/e-nope/archive', { archived: true }), 404, 'not_found', 'edit not found')
    // An edit of the ACTIVE list can be archived — the active rule is the list's.
    const a = await POST('/edits/e1/archive', {})
    expect(a.status).toBe(200)
    expect(a.body.archived_at).toBeTruthy()
    const again = await POST('/edits/e1/archive', { archived: true })
    expect(again.body.archived_at).toBe(a.body.archived_at)
    const r = await POST('/edits/e1/archive', { archived: false })
    expect(r.body).toMatchObject({ archived_at: null, archived_by: null })
    expect(disk().edits[0]).toMatchObject({ archived_at: null, archived_by: null })
  })
})

// ── rule 7 — the project PATCH, lifted from main.cjs ────────────────────────
//
// The handler is inline in startLocalServer, so it is lifted by brace
// matching from its registration and rebuilt over an in-memory bundle, with
// the folder helpers stubbed (none of them can decide this rule).
describe('rule 7 — the project PATCH refuses a CHANGE to active_shot_list_id', () => {
  function replayPatch(bundle) {
    const writesSeen = []
    const body = extractRouteBody(MAIN_CJS, "expressApp.patch('/api/rabbit/projects/:id',")
    // eslint-disable-next-line no-new-func
    const handler = new Function(
      'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'folderRootRefusal', 'fileSlugify', 'path', 'fs',
      'resolveConfiguredRootDir', 'ensureProjectFolderRows', 'materializeFolderDirs',
      `return (req, res) => ${body}`,
    )(
      () => bundle,
      (_id, b) => { writesSeen.push(structuredClone(b)) },
      rabbitNotFound,
      () => ({ error: 'no' }),
      (s) => String(s),
      path,
      { existsSync: () => false, renameSync: () => { throw new Error('no disk here') } },
      () => null,
      () => false,
      () => {},
    )
    const call = (reqBody) => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
      handler({ params: { id: PID }, body: reqBody }, res)
      return res
    }
    return { call, writesSeen }
  }
  const MSG = 'the active shot list is changed only by a project manager or a workspace admin, through set_active_shot_list()'

  it('a changed pointer is 403 forbidden and nothing is written', () => {
    const bundle = { project: { id: PID, title: 'P', active_shot_list_id: 'L1' } }
    const { call, writesSeen } = replayPatch(bundle)
    for (const next of ['L2', null, '']) {
      const res = call({ active_shot_list_id: next, description: 'x' })
      expect(res.code).toBe(403)
      expect(res.body).toEqual({ error: MSG, code: 'forbidden' })
    }
    expect(writesSeen).toEqual([])
    expect(bundle.project).toEqual({ id: PID, title: 'P', active_shot_list_id: 'L1' })
    // …and from no pointer to one.
    const fresh = { project: { id: PID, title: 'P' } }
    const r2 = replayPatch(fresh)
    expect(r2.call({ active_shot_list_id: 'L9' }).code).toBe(403)
    expect(r2.writesSeen).toEqual([])
  })

  it('FAILING CONTROL: an unchanged pointer (the whole row echoed) passes and the patch lands', () => {
    const bundle = { project: { id: PID, title: 'P', active_shot_list_id: 'L1' } }
    const { call, writesSeen } = replayPatch(bundle)
    const res = call({ id: PID, title: 'P', active_shot_list_id: 'L1', description: 'echoed' })
    expect(res.code).toBe(200)
    expect(res.body).toMatchObject({ active_shot_list_id: 'L1', description: 'echoed' })
    expect(writesSeen).toHaveLength(1)
  })

  it('absent and null count as the same "no active list"; a body without the key passes', () => {
    const bundle = { project: { id: PID, title: 'P' } }
    const { call, writesSeen } = replayPatch(bundle)
    expect(call({ active_shot_list_id: null, description: 'a' }).code).toBe(200)
    expect(call({ description: 'b' }).code).toBe(200)
    expect(writesSeen).toHaveLength(2)
  })
})

// ── rule 8 — the sweep, directly ────────────────────────────────────────────
describe('rule 8 — sweepShotListLinks', () => {
  function bundle() {
    return {
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }), item('i2', 'L2', { scene: 'sc-1' }),
        item('i3', 'L1', { shot: 'sh-1' }), item('i4', 'L1', { scene: 'sc-2' }),
      ],
      tasks: [
        { id: 't1', scene_id: 'sc-1', shot_id: 'sh-1', updated_at: T0 },
        { id: 't2', scene_id: 'sc-2', shot_id: null, updated_at: T0 },
      ],
      assets: [{ id: 'a1', scene_ids: ['sc-1'], shot_ids: ['sh-1'] }],
      edits: [edit('e1', 'L1', { items: [{ id: 'x', scene_id: 'sc-1', shot_id: 'sh-1', label: '', notes: '' }] })],
    }
  }

  it('a scene: its items leave every list, its tasks lose scene_id only', () => {
    const b = bundle()
    const before = structuredClone(b)
    expect(sweepShotListLinks(b, 'scene', 'sc-1')).toEqual({ items: 2, tasks: 1 })
    expect(b.shotListItems.map(i => i.id)).toEqual(['i3', 'i4'])
    expect(b.tasks[0]).toMatchObject({ scene_id: null, shot_id: 'sh-1' })
    expect(b.tasks[0].updated_at).not.toBe(T0)
    expect(b.tasks[1]).toEqual(before.tasks[1])
    expect(b.assets).toEqual(before.assets) // arrays are not FKs (0084 §6c)
    expect(b.edits).toEqual(before.edits) // D17: "Missing shot"
  })

  it('a shot: its items leave, its tasks lose shot_id only', () => {
    const b = bundle()
    expect(sweepShotListLinks(b, 'shot', 'sh-1')).toEqual({ items: 1, tasks: 1 })
    expect(b.shotListItems.map(i => i.id)).toEqual(['i1', 'i2', 'i4'])
    expect(b.tasks[0]).toMatchObject({ scene_id: 'sc-1', shot_id: null })
  })

  it('FAILING CONTROL: an id nothing names changes nothing', () => {
    const b = bundle()
    const before = structuredClone(b)
    expect(sweepShotListLinks(b, 'scene', 'sc-none')).toEqual({ items: 0, tasks: 0 })
    expect(sweepShotListLinks(b, 'shot', 'sc-1')).toEqual({ items: 0, tasks: 0 }) // a SCENE id swept as a shot
    expect(b).toEqual(before)
  })

  it('tolerates a bundle without the arrays, and refuses an unknown kind', () => {
    expect(sweepShotListLinks({}, 'scene', 'sc-1')).toEqual({ items: 0, tasks: 0 })
    expect(() => sweepShotListLinks({}, 'level', 'x')).toThrow(/kind/)
  })
})

// ── rule 9 — the read-time backfill ─────────────────────────────────────────
describe('rule 9 — backfillShotListsOnRead / ensureShotListKeys', () => {
  let n
  const newId = () => `bf-${++n}`
  beforeEach(() => { n = 0 })
  const legacy = () => ({
    project: { id: PID, title: 'Legacy' },
    scenes: [
      { id: 'sc-b', scene_number: 2 }, { id: 'sc-null', scene_number: null }, { id: 'sc-a', scene_number: 1 },
    ],
    shots: [
      { id: 'sh-a2', scene_id: 'sc-a', shot_number: 2 }, { id: 'sh-a1', scene_id: 'sc-a', shot_number: 1 },
      { id: 'sh-b1', scene_id: 'sc-b', shot_number: 1 }, { id: 'sh-loose', scene_id: null, shot_number: 5 },
    ],
  })

  it('a legacy bundle gets "Shot list 1 · v1", active, every scene and shot in backfill order, no edit', () => {
    const b = legacy()
    expect(backfillShotListsOnRead(b, { newId, now: T0 })).toBe(true)
    expect(b.shotLists).toEqual([{
      id: 'bf-1', project_id: PID, workspace_id: null, title: 'Shot list 1', version: 1,
      summary: 'Created from existing scenes', snapshot: {}, archived_at: null, archived_by: null,
      created_at: T0, created_by: null, updated_at: T0, updated_by: null,
    }])
    expect(b.project.active_shot_list_id).toBe('bf-1')
    expect(b.edits).toEqual([])
    expect(b.shotListItems.map(i => [i.scene_id || i.shot_id, i.position])).toEqual([
      ['sc-a', 0], ['sc-b', 1], ['sc-null', 2], // scene_number, nulls last
      ['sh-a1', 0], ['sh-a2', 1], // shots within their scene, by number
      ['sh-b1', 0],
      ['sh-loose', 0], // the unlinked bucket restarts at 0
    ])
    for (const i of b.shotListItems) {
      expect(Object.keys(i).sort()).toEqual(ITEM_KEYS)
      expect(i).toMatchObject({ shot_list_id: 'bf-1', project_id: PID, workspace_id: null })
    }
  })

  it('…exactly once: the same bundle read again is untouched', () => {
    const b = legacy()
    backfillShotListsOnRead(b, { newId, now: T0 })
    const after = structuredClone(b)
    expect(backfillShotListsOnRead(b, { newId, now: T0 })).toBe(false)
    expect(ensureShotListKeys(b)).toBe(false)
    expect(b).toEqual(after)
  })

  it('FAILING CONTROL: a NEW bundle with shotLists [] is never backfilled, even with scenes', () => {
    const b = { ...legacy(), shotLists: [] }
    expect(backfillShotListsOnRead(b, { newId, now: T0 })).toBe(false)
    expect(b.shotLists).toEqual([])
    expect(b.project.active_shot_list_id).toBeUndefined()
    // …only its siblings are ensured.
    expect(ensureShotListKeys(b)).toBe(true)
    expect(b.shotListItems).toEqual([])
    expect(b.edits).toEqual([])
    expect(n).toBe(0)
  })

  it('ensureShotListKeys leaves a legacy bundle for the backfill (it must not create shotLists)', () => {
    const b = legacy()
    expect(ensureShotListKeys(b)).toBe(false)
    expect(b.shotLists).toBeUndefined()
  })

  it('a legacy bundle with no scenes and no shots gets the keys and no list', () => {
    const b = { project: { id: PID } }
    expect(backfillShotListsOnRead(b, { newId, now: T0 })).toBe(true)
    expect(b).toEqual({ project: { id: PID, active_shot_list_id: null }, shotLists: [], shotListItems: [], edits: [] })
  })

  it('shots only (no scenes) still backfill — "scenes OR shots"', () => {
    const b = { project: { id: PID }, shots: [{ id: 'sh-1', scene_id: null }] }
    backfillShotListsOnRead(b, { newId, now: T0 })
    expect(b.shotLists).toHaveLength(1)
    expect(b.shotListItems.map(i => i.shot_id)).toEqual(['sh-1'])
  })

  it('an already-set pointer is left alone (0084: WHERE active_shot_list_id IS NULL)', () => {
    const b = legacy()
    b.project.active_shot_list_id = 'kept'
    backfillShotListsOnRead(b, { newId, now: T0 })
    expect(b.project.active_shot_list_id).toBe('kept')
  })

  it('a malformed legacy bundle keeps any items or edits arrays it already had (never delete)', () => {
    const b = { ...legacy(), shotListItems: [{ id: 'stray' }], edits: [{ id: 'stray-edit' }] }
    backfillShotListsOnRead(b, { newId, now: T0 })
    expect(b.shotListItems[0]).toEqual({ id: 'stray' })
    expect(b.edits).toEqual([{ id: 'stray-edit' }])
  })

  it('a route reading a legacy bundle backfills it and its own write persists the backfill', async () => {
    store.set(PID, JSON.stringify(legacy()))
    const r = await POST('/shot-lists', { title: 'Pickups' })
    expect(r.status).toBe(200)
    const d = disk()
    expect(d.shotLists.map(l => l.title)).toEqual(['Shot list 1', 'Pickups'])
    expect(d.project.active_shot_list_id).toBe(d.shotLists[0].id)
    expect(d.shotListItems).toHaveLength(7)
  })
})

// ── rule 9 through main.cjs's readRabbitBundle (lifted) ─────────────────────
//
// The pure functions above could be right and main.cjs could still never call
// them, or call them without marking the bundle dirty — the backfill would
// then re-run on every read with fresh ids. This replays the real function
// over a fake disk.
describe('rule 9 — readRabbitBundle backfills a legacy bundle once and persists it', () => {
  function replayRead(initial) {
    const files = new Map([['/fake/p1/project.json', JSON.stringify(initial)]])
    const diskWrites = []
    let ids = 0
    // eslint-disable-next-line no-new-func
    const read = new Function(
      'rabbitBundlePath', 'readJSON', 'writeJSON', 'fileSlugify', 'localDemoRootDir', 'isPathInside', 'fs', 'path',
      'localDemoProjectsDir', 'rabbitLogFileEvent', 'ensureProjectFolders', 'ensureProjectFolderRows',
      'materializeFolderDirs', 'uuidv4', 'backfillShotListsOnRead', 'ensureShotListKeys',
      `${extractFunction(MAIN_CJS, 'readRabbitBundle')}
       return readRabbitBundle;`,
    )(
      (id) => `/fake/${id}/project.json`,
      (file, fallback) => (files.has(file) ? JSON.parse(files.get(file)) : fallback),
      (file, data) => { files.set(file, JSON.stringify(data)); diskWrites.push(file) },
      (s) => s, () => null, () => false, { existsSync: () => false }, path,
      () => '/fake/projects', () => {}, () => {}, () => false, () => {},
      () => `rid-${++ids}`, backfillShotListsOnRead, ensureShotListKeys,
    )
    return { read, diskWrites, files }
  }
  const FULL = () => ({
    project: { id: PID, title: 'P' },
    projectTeam: [], managedFiles: [], budgetLines: [], budgetActuals: [], budgetVersions: [], expenses: [],
    levels: [], experiences: [], fileEvents: [], folders: [],
    scenes: [{ id: 'sc-1', scene_number: 1 }], shots: [{ id: 'sh-1', scene_id: 'sc-1', shot_number: 1 }],
  })

  it('the first read writes the backfill; the second reads it back and writes nothing', () => {
    const { read, diskWrites } = replayRead(FULL())
    const first = read(PID)
    expect(first.shotLists).toHaveLength(1)
    expect(first.project.active_shot_list_id).toBe(first.shotLists[0].id)
    expect(diskWrites).toHaveLength(1)
    const second = read(PID)
    expect(second.shotLists).toEqual(first.shotLists) // the SAME ids: persisted, not re-minted
    expect(second.shotListItems).toEqual(first.shotListItems)
    expect(diskWrites).toHaveLength(1)
  })

  it('FAILING CONTROL: a current bundle (shotLists present) is neither backfilled nor rewritten', () => {
    const { read, diskWrites } = replayRead({ ...FULL(), shotLists: [], shotListItems: [], edits: [] })
    const b = read(PID)
    expect(b.shotLists).toEqual([])
    expect(diskWrites).toHaveLength(0)
  })

  it('a bundle with shotLists but no siblings gains them, persisted, with no list', () => {
    const { read, diskWrites } = replayRead({ ...FULL(), shotLists: [] })
    const b = read(PID)
    expect(b.shotListItems).toEqual([])
    expect(b.edits).toEqual([])
    expect(b.shotLists).toEqual([])
    expect(diskWrites).toHaveLength(1)
  })
})

// ── wiring pins ──────────────────────────────────────────────────────────────
// This file mounts the module on a fresh app with no catch-all, so it would
// stay green with the mount AFTER the SPA fallback (the bins' measured 404s).
describe('main.cjs wiring', () => {
  it('mounts the shot-list routes after the /api/rabbit guard and before the static / SPA fallback', () => {
    const mount = MAIN_CJS.indexOf('mountRabbitShotLists(expressApp')
    const guard = MAIN_CJS.indexOf("expressApp.use('/api/rabbit', localDemoMissingGuard)")
    expect(mount).toBeGreaterThan(0)
    if (guard >= 0) expect(mount).toBeGreaterThan(guard)
    expect(MAIN_CJS.indexOf('express.static(distPath)')).toBeGreaterThan(mount)
    expect(MAIN_CJS.indexOf("expressApp.get('/{*splat}'")).toBeGreaterThan(mount)
  })

  it('emptyBundle gives a new project the three keys (so it is never backfilled)', () => {
    const src = extractFunction(MAIN_CJS, 'emptyBundle')
    for (const k of ['shotLists', 'shotListItems', 'edits']) expect(src).toMatch(new RegExp(`\\b${k}:\\s*\\[\\]`))
  })

  it('mirrorProjectDatabases writes scenes.json with the five collections (D21)', () => {
    const src = extractFunction(MAIN_CJS, 'mirrorProjectDatabases')
    const at = src.indexOf("'scenes.json'")
    expect(at).toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('});', at))
    for (const k of ['shotLists', 'shotListItems', 'scenes', 'shots', 'edits']) {
      expect(block).toMatch(new RegExp(`\\b${k}:\\s*bundle\\.${k}\\s*\\|\\|\\s*\\[\\]`))
    }
  })
})
