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
// …and the review-round-1 addendum (S3A_CONTRACT_R1.md), each with its own
// failing control:
//   A the membership DELTA routes (POST …/items, POST …/items/delete)
//   B (an archived list's membership frozen) — REVERTED by R2-1 below; the
//     delete sweep and the read-time prune reach archived lists either way
//   C a scene's cascade takes its shots (cascadeSceneOrShotDelete; replayed
//     through the factory in desktopDeleteSweep.test.js)
//   D titles are stored trimmed
//   E one linear chain of edits per list
//   H prune on read, deterministic backfill ids, one mirror after a backfill
// …and the review-round-2 addendum (S3A_CONTRACT_R2.md):
//   R2-1 an ARCHIVED list's items may be replaced, upserted, repositioned and
//        deleted again (the freeze broke the undo of a scene delete); the
//        tests that pinned the 409 are now "allowed" controls
//   R2-2 POST …/items { positionsOnly: true } moves rows that EXIST in this
//        list and never inserts (a stale reorder re-inserted removed rows)
// Messages are typed out here, not imported, so a changed message fails.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const {
  mountRabbitShotLists, ensureShotListKeys, backfillShotListsOnRead, sweepShotListLinks,
  pruneDanglingShotListItems, cascadeSceneOrShotDelete, backfillListId, backfillItemId,
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

  it('addendum D: the title is STORED trimmed, on create and on update (0084 §7a: btrim)', async () => {
    seed({ shotLists: [list('L1', { title: 'Main' })] })
    const created = await POST('/shot-lists', { title: '  Pickups \t', version: 1 })
    expect(created.body.title).toBe('Pickups')
    const renamed = await POST('/shot-lists', { id: 'L1', title: ' Main cut  ' })
    expect(renamed.body.title).toBe('Main cut')
    expect(disk().shotLists.map(l => l.title)).toEqual(['Main cut', 'Pickups'])
    // …so the D14 label a person reads never carries the spaces.
    refused(await POST('/shot-lists', { title: 'Pickups ', version: 1 }), 409, 'conflict',
      'There is already a shot list called "Pickups · v1".')
  })

  it('addendum D: a stored title that still has spaces is compared trimmed and reported trimmed', async () => {
    // A row written before the rule (or by hand) keeps its spaces until it is
    // next saved; it must still clash, and the sentence must not echo them.
    seed({ shotLists: [list('L1', { title: ' Legacy  ', version: 2 })] })
    refused(await POST('/shot-lists', { title: 'Legacy', version: 2 }), 409, 'conflict',
      'There is already a shot list called "Legacy · v2".')
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

  it('post-overhaul S3b\'s patch: the body localServerAdapter.patchShotList sends — the title alone — keeps the stored version, summary and snapshot', async () => {
    seed({ shotLists: [list('L1', { version: 3, summary: 'Theirs, newer', snapshot: { kind: 'shot_list', saved_at: T0 } })] })
    const r = await POST('/shot-lists', { title: 'Main shoot', id: 'L1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: 'L1', title: 'Main shoot', version: 3, summary: 'Theirs, newer', snapshot: { kind: 'shot_list', saved_at: T0 } })
    expect(disk().shotLists).toHaveLength(1)
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

  it('R2-1: an ARCHIVED list\'s membership may be replaced again — written, and the list stays archived', async () => {
    // Round 2 reverted R1 addendum B's freeze on every backend: with it,
    // deleting a scene and pressing Ctrl+Z dropped the scene from every
    // archived list for good. Re-adding the 409 fails this test.
    seed({
      shotLists: [list('L1', { archived_at: T0 }), list('L2', { title: 'Live' })],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0)],
    })
    const r = await PUT('/shot-lists/L1/items', { items: [{ id: 'i1', scene_id: 'sc-1', position: 1 }, { scene_id: 'sc-2', position: 0 }] })
    expect(r.status).toBe(200)
    expect(r.body.map(i => [i.id, i.scene_id, i.position])).toEqual([['id-0001', 'sc-2', 0], ['i1', 'sc-1', 1]])
    const d = disk()
    expect(d.shotListItems.filter(i => i.shot_list_id === 'L1').map(i => i.scene_id).sort()).toEqual(['sc-1', 'sc-2'])
    expect(d.shotLists[0].archived_at).toBe(T0) // the membership moved; the list was not restored
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('R2-1: a malformed body is still a 400 on an archived list, and an unknown list still a 404', async () => {
    seed({ shotLists: [list('L1', { archived_at: T0 })] })
    refused(await PUT('/shot-lists/L1/items', { items: 'x' }), 400, 'invalid', 'items must be a JSON array')
    refused(await PUT('/shot-lists/L-nope/items', { items: [] }), 404, 'not_found', 'shot list not found')
  })
})

// ── addendum A: the membership DELTA writes ─────────────────────────────────
//
// R1 provider#0 (HIGH): a whole-set replace sent from one client's view
// deleted what a collaborator had added since that client loaded — items are
// not broadcast. The provider now writes only the rows it means.
describe('addendum A — POST …/items upserts only the named rows', () => {
  function seedDelta() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }, 0),
        item('i2', 'L1', { shot: 'sh-1' }, 0),
        item('j1', 'L2', { scene: 'sc-1' }, 0),
      ],
    })
  }

  it('FAILING CONTROL for the whole point: rows the payload does not name are KEPT (the PUT deletes them)', async () => {
    // i2 stands for the collaborator's newer item this client never saw.
    seedDelta()
    const r = await POST('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2', position: 1 }] })
    expect(r.status).toBe(200)
    expect(disk().shotListItems.filter(i => i.shot_list_id === 'L1').map(i => i.id).sort()).toEqual(['i1', 'i2', 'id-0001'])
    // The same payload through the whole-set PUT loses i1 and i2 — which is
    // why the provider must not use it.
    seedDelta()
    await PUT('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2', position: 1 }] })
    expect(disk().shotListItems.filter(i => i.shot_list_id === 'L1').map(i => i.scene_id || i.shot_id)).toEqual(['sc-2'])
  })

  it('inserts new rows, updates this list\'s rows, skips another list\'s ids; answers the rows written in payload order', async () => {
    seedDelta()
    const r = await POST('/shot-lists/L1/items', { items: [
      { id: 'i2', shot_id: 'sh-2', position: 3 }, // own row: re-pointed and moved
      { id: 'j1', shot_id: 'sh-3', position: 0 }, // L2's id: skipped, not moved
      { id: 'new-1', scene_id: 'sc-2' }, // unknown id: inserted with it; position = its index (2)
      { shot_id: 'sh-1', position: 0 }, // no id: minted — sh-1 is free, i2 just left it
    ] })
    expect(r.status).toBe(200)
    expect(r.body.map(i => i.id)).toEqual(['i2', 'new-1', 'id-0001'])
    for (const row of r.body) expect(Object.keys(row).sort()).toEqual(ITEM_KEYS)
    expect(r.body[0]).toMatchObject({ shot_id: 'sh-2', scene_id: null, position: 3, created_at: T0, shot_list_id: 'L1' })
    expect(r.body[0].updated_at).not.toBe(T0)
    expect(r.body[1]).toMatchObject({ scene_id: 'sc-2', position: 2, shot_list_id: 'L1', project_id: PID, workspace_id: null })
    const d = disk()
    expect(d.shotListItems.find(i => i.id === 'i1')).toEqual(item('i1', 'L1', { scene: 'sc-1' }, 0)) // untouched
    expect(d.shotListItems.find(i => i.id === 'j1')).toEqual(item('j1', 'L2', { scene: 'sc-1' }, 0)) // not moved
    expect(d.shotListItems.some(i => i.shot_id === 'sh-3')).toBe(false)
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('FAILING CONTROL: the list AFTER the write holds each scene and shot once — a row it keeps counts', async () => {
    seedDelta()
    // sc-1 is held by i1, which this payload does not name.
    refused(await POST('/shot-lists/L1/items', { items: [{ scene_id: 'sc-1' }] }), 409, 'conflict',
      'a shot list holds each scene and each shot once')
    refused(await POST('/shot-lists/L1/items', { items: [{ id: 'fresh', shot_id: 'sh-1' }] }), 409, 'conflict',
      'a shot list holds each scene and each shot once')
    refused(await POST('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2' }, { scene_id: 'sc-2', position: 4 }] }), 409, 'conflict',
      'a shot list holds each scene and each shot once')
    expect(writes).toEqual([])
    // CONTROLS: the same scene on ANOTHER list is fine (j1 is L2's), and a
    // row may take a scene another row gives up in the same request.
    expect((await POST('/shot-lists/L2/items', { items: [{ scene_id: 'sc-2' }] })).status).toBe(200)
    expect((await POST('/shot-lists/L1/items', { items: [{ id: 'i1', scene_id: 'sc-2' }, { scene_id: 'sc-1', position: 1 }] })).status).toBe(200)
  })

  it('validates every written row as rule 2 does, all-or-nothing', async () => {
    const b = seedDelta()
    const bad = [
      [{ items: 'x' }, 400, 'invalid', 'items must be a JSON array'],
      [{ items: [{ scene_id: 'sc-1', shot_id: 'sh-1' }] }, 400, 'invalid', 'each item names exactly one scene or one shot'],
      [{ items: [{ scene_id: 'sc-elsewhere' }] }, 400, 'invalid', 'an item names a scene or shot that is not in this project'],
      [{ items: [{ shot_id: 'sh-3' }, { shot_id: 'sh-2', position: -1 }] }, 400, 'invalid', 'an item\'s position must be a whole number of at least 0'],
      [{ items: [{ id: 'k', shot_id: 'sh-3' }, { id: 'k', shot_id: 'sh-2' }] }, 400, 'invalid', 'an item id appears more than once'],
    ]
    for (const [body, status, code, error] of bad) refused(await POST('/shot-lists/L1/items', body), status, code, error)
    refused(await POST('/shot-lists/L-nope/items', { items: [] }), 404, 'not_found', 'shot list not found')
    expect(disk()).toEqual(b)
    expect(writes).toEqual([])
  })

  it('an empty payload, or one whose every id is another list\'s, writes nothing and answers []', async () => {
    seedDelta()
    expect((await POST('/shot-lists/L1/items', { items: [] })).body).toEqual([])
    expect((await POST('/shot-lists/L1/items', { items: [{ id: 'j1', shot_id: 'sh-3' }] })).body).toEqual([])
    expect(writes).toEqual([])
  })

  it('R2-1: an ARCHIVED list takes the delta again — an insert and an update are both written', async () => {
    // The undo of a scene delete re-inserts the scene's rows in EVERY list
    // it was in, archived ones included. Re-adding the 409 fails this test.
    seed({ shotLists: [list('L1', { archived_at: T0 })], shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0)] })
    const add = await POST('/shot-lists/L1/items', { items: [{ id: 'back-1', scene_id: 'sc-2', position: 1 }] })
    expect(add.status).toBe(200)
    expect(add.body.map(i => i.id)).toEqual(['back-1'])
    const upd = await POST('/shot-lists/L1/items', { items: [{ id: 'i1', scene_id: 'sc-1', position: 5 }] })
    expect(upd.status).toBe(200)
    expect(upd.body[0]).toMatchObject({ id: 'i1', position: 5 })
    const d = disk()
    expect(d.shotListItems.map(i => [i.id, i.position])).toEqual([['i1', 5], ['back-1', 1]])
    expect(d.shotLists[0].archived_at).toBe(T0)
    expect(writes).toHaveLength(2)
  })
})

// ── R2-2: the positions-only write (a reorder never inserts) ────────────────
//
// sql2#1 / provider2#2 / parity2#0 (MEDIUM): planReorderList renumbers every
// item of a group from this client's view, so a reorder made after a
// collaborator removed an item names that item's id. As an upsert, an id the
// list no longer holds was INSERTED — the removal undone, silently, for
// everyone. Undo and redo of a reorder sent the same rows.
describe('R2-2 — POST …/items { positionsOnly: true } moves existing rows only', () => {
  function seedMove() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }, 0),
        item('i2', 'L1', { scene: 'sc-2' }, 1),
        item('i3', 'L1', { shot: 'sh-1' }, 0),
        item('j1', 'L2', { scene: 'sc-1' }, 0),
      ],
    })
  }
  const MOVE = (listId, items, extra = {}) => POST(`/shot-lists/${listId}/items`, { items, positionsOnly: true, ...extra })

  it('FAILING CONTROL for the whole point: a stale reorder naming a REMOVED row skips it — the upsert re-inserts it', async () => {
    // A collaborator removed i1 (sc-1) from L1. This client never saw that,
    // and drags sc-2 to the top: planReorderList sends [i2 → 0, i1 → 1].
    const collaboratorRemovedI1 = () => {
      const b = seedMove()
      store.set(PID, JSON.stringify({ ...b, shotListItems: b.shotListItems.filter(i => i.id !== 'i1') }))
    }
    const stale = [{ id: 'i2', scene_id: 'sc-2', position: 0 }, { id: 'i1', scene_id: 'sc-1', position: 1 }]
    collaboratorRemovedI1()
    const r = await MOVE('L1', stale)
    expect(r.status).toBe(200)
    expect(r.body.map(i => i.id)).toEqual(['i2']) // the skipped id is not returned
    expect(disk().shotListItems.filter(i => i.shot_list_id === 'L1').map(i => [i.id, i.position])).toEqual([['i2', 0], ['i3', 0]])
    // The SAME payload without the flag is the upsert, which inserts the
    // unknown id — the collaborator's removal undone for everyone. That is
    // the path R2-2 takes the reorder off.
    collaboratorRemovedI1()
    const u = await POST('/shot-lists/L1/items', { items: stale })
    expect(u.status).toBe(200)
    expect(disk().shotListItems.some(i => i.id === 'i1' && i.shot_list_id === 'L1' && i.scene_id === 'sc-1')).toBe(true)
  })

  it('moves only position: scene_id / shot_id in the payload are ignored; created_at kept, updated_at moves; rows answered in payload order', async () => {
    seedMove()
    const r = await MOVE('L1', [
      { id: 'i3', shot_id: 'sh-2', position: 4 }, // a different shot named: ignored
      { id: 'i1', scene_id: 'sc-2', position: 2 }, // a different scene named: ignored
      { id: 'i2', position: 1 }, // unchanged position: still an update, still answered
    ])
    expect(r.status).toBe(200)
    expect(r.body.map(i => [i.id, i.scene_id, i.shot_id, i.position])).toEqual([
      ['i3', null, 'sh-1', 4], ['i1', 'sc-1', null, 2], ['i2', 'sc-2', null, 1],
    ])
    for (const row of r.body) {
      expect(Object.keys(row).sort()).toEqual(ITEM_KEYS)
      expect(row.created_at).toBe(T0)
      expect(row.updated_at).not.toBe(T0)
      expect(row.shot_list_id).toBe('L1')
    }
    const d = disk()
    // Rows keep their place in the bundle; L2's j1 is untouched.
    expect(d.shotListItems.map(i => [i.id, i.position])).toEqual([['i1', 2], ['i2', 1], ['i3', 4], ['j1', 0]])
    expect(d.shotListItems[3]).toEqual(item('j1', 'L2', { scene: 'sc-1' }, 0))
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('FAILING CONTROL: another list\'s id is skipped — not moved, not returned; a payload that moves nothing writes nothing', async () => {
    const b = seedMove()
    const r = await MOVE('L1', [{ id: 'j1', position: 9 }, { id: 'nope', position: 3 }])
    expect(r).toEqual({ status: 200, body: [] })
    expect((await MOVE('L1', [])).body).toEqual([])
    expect(disk()).toEqual(b)
    expect(writes).toEqual([])
    // CONTROL: j1 moves when it is named through ITS list.
    expect((await MOVE('L2', [{ id: 'j1', position: 9 }])).body.map(i => [i.id, i.position])).toEqual([['j1', 9]])
  })

  it('validates every row, all-or-nothing: an id each, once, and a whole-number position ≥ 0 (required)', async () => {
    const b = seedMove()
    const bad = [
      [{ items: 'x', positionsOnly: true }, 'items must be a JSON array'],
      [{ positionsOnly: true }, 'items must be a JSON array'],
      [{ items: [{ position: 0 }], positionsOnly: true }, 'each item of a reorder needs an id'],
      [{ items: [{ id: '', position: 0 }], positionsOnly: true }, 'each item of a reorder needs an id'],
      [{ items: [null], positionsOnly: true }, 'each item of a reorder needs an id'],
      [{ items: [{ id: 'i1' }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
      [{ items: [{ id: 'i1', position: null }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
      [{ items: [{ id: 'i1', position: -1 }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
      [{ items: [{ id: 'i1', position: 1.5 }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
      [{ items: [{ id: 'i1', position: '2' }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
      // Good rows first, then the bad one: nothing is written.
      [{ items: [{ id: 'i1', position: 3 }, { id: 'i2', position: 2 }, { id: 'i1', position: 0 }], positionsOnly: true }, 'an item id appears more than once'],
      [{ items: [{ id: 'i1', position: 3 }, { id: 'i2', position: -2 }], positionsOnly: true }, 'an item\'s position must be a whole number of at least 0'],
    ]
    for (const [body, error] of bad) refused(await POST('/shot-lists/L1/items', body), 400, 'invalid', error)
    refused(await MOVE('L-nope', [{ id: 'i1', position: 0 }]), 404, 'not_found', 'shot list not found')
    expect(disk()).toEqual(b)
    expect(writes).toEqual([])
  })

  it('positionsOnly is read strictly: only a boolean; false / null / absent is the upsert', async () => {
    seedMove()
    for (const positionsOnly of ['true', 1, 'yes', {}]) {
      refused(await MOVE('L1', [{ id: 'gone-1', scene_id: 'sc-1', position: 0 }], { positionsOnly }), 400, 'invalid',
        'positionsOnly must be true or false')
    }
    expect(writes).toEqual([])
    // CONTROL: false and null take the upsert path (a new scene item is inserted).
    expect((await MOVE('L1', [{ shot_id: 'sh-2', position: 1 }], { positionsOnly: false })).body.map(i => i.shot_id)).toEqual(['sh-2'])
    expect((await MOVE('L1', [{ shot_id: 'sh-3', position: 0 }], { positionsOnly: null })).body.map(i => i.shot_id)).toEqual(['sh-3'])
  })

  it('R2-1: an ARCHIVED list can be repositioned (its undo / restore paths write it)', async () => {
    seed({
      shotLists: [list('L1', { archived_at: T0 })],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0), item('i2', 'L1', { scene: 'sc-2' }, 1)],
    })
    const r = await MOVE('L1', [{ id: 'i1', position: 1 }, { id: 'i2', position: 0 }])
    expect(r.status).toBe(200)
    expect(disk().shotListItems.map(i => [i.id, i.position])).toEqual([['i1', 1], ['i2', 0]])
    expect(disk().shotLists[0].archived_at).toBe(T0)
  })

  it('a dangling row (its scene gone) is pruned on read, so a reorder naming it skips it — and the write persists the prune', async () => {
    seed({
      shotLists: [list('L1')],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0), item('dangling', 'L1', { scene: 'sc-gone' }, 1)],
    })
    const r = await MOVE('L1', [{ id: 'dangling', position: 0 }, { id: 'i1', position: 1 }])
    expect(r.body.map(i => i.id)).toEqual(['i1'])
    expect(disk().shotListItems.map(i => i.id)).toEqual(['i1'])
  })
})

describe('addendum A — POST …/items/delete deletes exactly the named ids of this list', () => {
  function seedDel() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }, 0),
        item('i2', 'L1', { shot: 'sh-1' }, 0),
        item('i3', 'L1', { scene: 'sc-2' }, 1),
        item('j1', 'L2', { scene: 'sc-1' }, 0),
      ],
    })
  }

  it('deletes those ids and nothing else; ids of another list or of nothing are ignored', async () => {
    seedDel()
    const r = await POST('/shot-lists/L1/items/delete', { ids: ['i3', 'j1', 'nope', 'i1', 'i3'] })
    expect(r).toEqual({ status: 200, body: { deleted: ['i3', 'i1'] } }) // asked-for order, once each
    const d = disk()
    expect(d.shotListItems.map(i => i.id)).toEqual(['i2', 'j1']) // i2 not named: kept; j1 is L2's
    expect(writes).toEqual([{ id: PID, touch: true }])
  })

  it('FAILING CONTROL: ids that name nothing in this list write nothing and answer { deleted: [] }', async () => {
    const b = seedDel()
    expect((await POST('/shot-lists/L1/items/delete', { ids: ['j1', 'nope'] })).body).toEqual({ deleted: [] })
    expect((await POST('/shot-lists/L1/items/delete', { ids: [] })).body).toEqual({ deleted: [] })
    expect(disk()).toEqual(b)
    expect(writes).toEqual([])
  })

  it('ids must be an array; the list must exist', async () => {
    seedDel()
    for (const body of [{}, { ids: 'i1' }, { ids: null }, { items: ['i1'] }]) {
      refused(await POST('/shot-lists/L1/items/delete', body), 400, 'invalid', 'ids must be a JSON array')
    }
    refused(await POST('/shot-lists/L-nope/items/delete', { ids: ['i1'] }), 404, 'not_found', 'shot list not found')
    expect(writes).toEqual([])
  })

  it('R2-1: an ARCHIVED list\'s items can be deleted again (the redo of an undone add reaches it)', async () => {
    // Re-adding the 409 fails this test.
    seed({
      shotLists: [list('L1', { archived_at: T0 })],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0), item('i2', 'L1', { scene: 'sc-2' }, 1)],
    })
    expect(await POST('/shot-lists/L1/items/delete', { ids: ['i1'] })).toEqual({ status: 200, body: { deleted: ['i1'] } })
    expect(disk().shotListItems.map(i => i.id)).toEqual(['i2'])
    expect(disk().shotLists[0].archived_at).toBe(T0)
    expect(writes).toEqual([{ id: PID, touch: true }])
  })
})

// ── rule 3 ───────────────────────────────────────────────────────────────────
describe('rule 3 — upsertEdit', () => {
  // L1 and L2 each hold one edit, a root; L3 holds none. Since the chain rule
  // (addendum E), a new edit on L1 or L2 must continue from e1 / e2, and a
  // new ROOT can only start on L3.
  function seedEdits() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' }), list('L3', { title: 'Empty' })],
      edits: [edit('e1', 'L1'), edit('e2', 'L2')],
    })
  }

  it('creates a row of exactly the contract shape: items [] and snapshot null by default', async () => {
    seedEdits()
    const r = await POST('/edits', { shot_list_id: 'L3', title: 'Assembly', project_id: 'elsewhere', bogus: true })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(EDIT_KEYS)
    expect(r.body).toMatchObject({
      project_id: PID, workspace_id: null, shot_list_id: 'L3', title: 'Assembly', version: 1, items: [],
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
    const r = await POST('/edits', { shot_list_id: 'L1', title: 'Rough', items, parent_edit_id: 'e1' })
    expect(r.body.items).toEqual(items)
  })

  it('addendum D: the title is STORED trimmed', async () => {
    seedEdits()
    const r = await POST('/edits', { shot_list_id: 'L3', title: '  Assembly  ' })
    expect(r.body.title).toBe('Assembly')
    const renamed = await POST('/edits', { id: 'e1', title: '\tFine cut ' })
    expect(renamed.body.title).toBe('Fine cut')
    expect(disk().edits.find(e => e.id === 'e1').title).toBe('Fine cut')
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
    expect((await POST('/edits', { shot_list_id: 'L1', title: 'Cut', version: 2, parent_edit_id: 'e1' })).status).toBe(200)
  })

  it('items must be a list; a snapshot must be an object or null', async () => {
    seedEdits()
    refused(await POST('/edits', { shot_list_id: 'L3', title: 'A', items: {} }), 400, 'invalid', 'An edit\'s items must be a list.')
    refused(await POST('/edits', { shot_list_id: 'L3', title: 'A', items: null }), 400, 'invalid', 'An edit\'s items must be a list.')
    refused(await POST('/edits', { shot_list_id: 'L3', title: 'A', snapshot: [] }), 400, 'invalid', 'An edit\'s snapshot must be an object.')
    refused(await POST('/edits', { shot_list_id: 'L3', title: 'A', snapshot: 'x' }), 400, 'invalid', 'An edit\'s snapshot must be an object.')
    expect(writes).toEqual([])
    const a = await POST('/edits', { shot_list_id: 'L3', title: 'A', snapshot: null })
    expect(a.status).toBe(200)
    expect((await POST('/edits', { shot_list_id: 'L3', title: 'B', snapshot: { kind: 'edit' }, parent_edit_id: a.body.id })).body.snapshot)
      .toEqual({ kind: 'edit' })
  })

  it('the parent is ANOTHER edit of the SAME list (D6: one linear chain per list)', async () => {
    seedEdits()
    const MSG = 'an edit\'s parent must be another edit of the same shot list'
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', parent_edit_id: 'e2' }), 400, 'invalid', MSG) // L2's
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'A', parent_edit_id: 'e-nope' }), 400, 'invalid', MSG)
    refused(await POST('/edits', { id: 'e-new', shot_list_id: 'L1', title: 'A', parent_edit_id: 'e-new' }), 400, 'invalid', MSG)
    // A STORED edit naming itself is changing its parent: since addendum E
    // that is the guard's refusal (0084 §7a fires before the CHECK), 403.
    refused(await POST('/edits', { id: 'e1', parent_edit_id: 'e1' }), 403, 'forbidden', 'an edit\'s place in its chain cannot change')
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

// ── addendum E: D6's ONE linear chain of edits per list ─────────────────────
//
// R1 sql#6: branching and a second root were accepted, so "the edit history
// of a list" could fork. 0084 §5 now has edits_one_root_per_list_key and
// edits_one_child_key, and §7a pins parent_edit_id.
describe('addendum E — one chain of edits per list', () => {
  // L1: e1 (root) -> e2 -> e3 (the latest). L2: no edits.
  function seedChain() {
    return seed({
      shotLists: [list('L1'), list('L2', { title: 'Other' })],
      edits: [
        edit('e1', 'L1', { title: 'Assembly' }),
        edit('e2', 'L1', { title: 'Rough', parent_edit_id: 'e1' }),
        edit('e3', 'L1', { title: 'Fine', parent_edit_id: 'e2' }),
      ],
    })
  }
  const ROOT = 'this shot list\'s edits form one chain — a new edit continues from the latest one'
  const BRANCH = 'an edit\'s parent must be the latest edit of its shot list'
  const FIXED = 'an edit\'s place in its chain cannot change'

  it('a second ROOT on a list is 409 conflict; a first root on another list is fine', async () => {
    const b = seedChain()
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Restart' }), 409, 'conflict', ROOT)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Restart', parent_edit_id: null }), 409, 'conflict', ROOT)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Restart', parent_edit_id: '' }), 409, 'conflict', ROOT)
    expect(disk().edits).toEqual(b.edits)
    expect(writes).toEqual([])
    // CONTROL: L2 has no edits, so its first one is its root.
    expect((await POST('/edits', { shot_list_id: 'L2', title: 'Restart' })).status).toBe(200)
  })

  it('FAILING CONTROL: continuing from the LATEST edit is accepted; naming an earlier one is a branch, 409', async () => {
    seedChain()
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Alt', parent_edit_id: 'e1' }), 409, 'conflict', BRANCH)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Alt', parent_edit_id: 'e2' }), 409, 'conflict', BRANCH)
    expect(writes).toEqual([])
    const r = await POST('/edits', { shot_list_id: 'L1', title: 'Online', parent_edit_id: 'e3' })
    expect(r.status).toBe(200)
    expect(r.body.parent_edit_id).toBe('e3')
    // …and now e3 has its child, so it is no longer the latest.
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Alt', parent_edit_id: 'e3' }), 409, 'conflict', BRANCH)
  })

  it('an ARCHIVED edit still counts for both rules (the indexes are unconditional)', async () => {
    seed({
      shotLists: [list('L1')],
      edits: [edit('e1', 'L1', { archived_at: T0 }), edit('e2', 'L1', { title: 'Rough', parent_edit_id: 'e1', archived_at: T0 })],
    })
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'New' }), 409, 'conflict', ROOT)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'New', parent_edit_id: 'e1' }), 409, 'conflict', BRANCH)
    // An archived latest edit can still be continued from: the child is a new
    // row, the archived parent is not changed.
    expect((await POST('/edits', { shot_list_id: 'L1', title: 'New', parent_edit_id: 'e2' })).status).toBe(200)
  })

  it('a stored edit\'s parent never changes — 403 forbidden, whatever it is changed to', async () => {
    const b = seedChain()
    refused(await POST('/edits', { id: 'e2', parent_edit_id: null }), 403, 'forbidden', FIXED) // cut loose
    refused(await POST('/edits', { id: 'e2', parent_edit_id: 'e3' }), 403, 'forbidden', FIXED) // a cycle
    refused(await POST('/edits', { id: 'e1', parent_edit_id: 'e3' }), 403, 'forbidden', FIXED) // root re-hung
    expect(disk().edits).toEqual(b.edits)
    expect(writes).toEqual([])
  })

  it('FAILING CONTROL: echoing the stored parent (or leaving it out) passes — an update is not a new link', async () => {
    const b = seedChain()
    expect((await POST('/edits', { ...b.edits[1], summary: 'notes' })).status).toBe(200) // e2, parent e1 echoed
    expect((await POST('/edits', { id: 'e1', summary: 'root', parent_edit_id: '' })).status).toBe(200) // '' = none = stored
    expect((await POST('/edits', { id: 'e3', title: 'Fine 2' })).status).toBe(200) // key absent
    expect(disk().edits.map(e => [e.id, e.parent_edit_id])).toEqual([['e1', null], ['e2', 'e1'], ['e3', 'e2']])
  })

  it('the chain rules judge NEW edits only: a bundle already holding two roots or a branch stays editable', async () => {
    // Written before this rule (an earlier S3a build on a dev machine's
    // rabbit-data). Their parents cannot change, so an update cannot make the
    // chain worse — refusing it would only trap the rows.
    seed({
      shotLists: [list('L1')],
      edits: [edit('r1', 'L1'), edit('r2', 'L1', { title: 'Other root' }),
        edit('c1', 'L1', { title: 'C1', parent_edit_id: 'r1' }), edit('c2', 'L1', { title: 'C2', parent_edit_id: 'r1' })],
    })
    expect((await POST('/edits', { id: 'r2', summary: 'still editable' })).status).toBe(200)
    expect((await POST('/edits', { id: 'c2', summary: 'still editable', parent_edit_id: 'r1' })).status).toBe(200)
    refused(await POST('/edits', { shot_list_id: 'L1', title: 'Third root' }), 409, 'conflict', ROOT) // a NEW one is judged
  })

  it('the pin is checked before the archive rules (0084 §7a\'s order)', async () => {
    seed({ shotLists: [list('L1')], edits: [edit('e1', 'L1'), edit('e2', 'L1', { title: 'R', parent_edit_id: 'e1', archived_at: T0 })] })
    refused(await POST('/edits', { id: 'e2', parent_edit_id: null, title: 'x' }), 403, 'forbidden', FIXED)
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

  it('the sweep reaches an ARCHIVED list (a referential clean-up, as the cloud\'s FK CASCADE)', () => {
    // i2 belongs to L2; mark L2 archived — its sc-1 item must still go, as the
    // cloud's FK CASCADE removes it (RLS does not judge a referential action).
    const b = { ...bundle(), shotLists: [list('L1'), list('L2', { archived_at: T0 })] }
    expect(sweepShotListLinks(b, 'scene', 'sc-1').items).toBe(2)
    expect(b.shotListItems.some(i => i.id === 'i2')).toBe(false)
    expect(b.shotLists[1].archived_at).toBe(T0)
  })
})

// ── addendum C: the scene cascade, directly ─────────────────────────────────
describe('addendum C — cascadeSceneOrShotDelete', () => {
  function bundle() {
    return {
      shotLists: [list('L1'), list('L2', { archived_at: T0 })],
      scenes: [{ id: 'sc-1' }, { id: 'sc-2' }],
      shots: [{ id: 'sh-1', scene_id: 'sc-1' }, { id: 'sh-b', scene_id: 'sc-1' }, { id: 'sh-2', scene_id: 'sc-2' }, { id: 'sh-loose', scene_id: null }],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }), item('i2', 'L1', { shot: 'sh-1' }),
        item('j1', 'L2', { shot: 'sh-b' }), item('i3', 'L1', { shot: 'sh-2' }), item('i4', 'L1', { shot: 'sh-loose' }),
      ],
      tasks: [
        { id: 't1', scene_id: 'sc-1', shot_id: 'sh-1', updated_at: T0 },
        { id: 't2', scene_id: null, shot_id: 'sh-b', updated_at: T0 },
        { id: 't3', scene_id: 'sc-2', shot_id: 'sh-2', updated_at: T0 },
      ],
    }
  }

  it('a scene takes its shots — and their items (the archived list\'s too) and task links — with it', () => {
    const b = bundle()
    const before = structuredClone(b)
    expect(cascadeSceneOrShotDelete(b, 'scene', 'sc-1')).toEqual({ items: 3, tasks: 2, shots: 2 })
    expect(b.shots.map(s => s.id)).toEqual(['sh-2', 'sh-loose'])
    expect(b.shotListItems.map(i => i.id)).toEqual(['i3', 'i4'])
    expect(b.tasks[0]).toMatchObject({ scene_id: null, shot_id: null }) // linked twice, counted once
    expect(b.tasks[1]).toMatchObject({ shot_id: null })
    expect(b.tasks[2]).toEqual(before.tasks[2])
    expect(b.scenes).toEqual(before.scenes) // the row itself is the factory's rabbitRemoveFrom
  })

  it('FAILING CONTROL: an unlinked shot (scene_id null) and another scene\'s shot are never taken', () => {
    const b = bundle()
    expect(cascadeSceneOrShotDelete(b, 'scene', 'sc-none')).toEqual({ items: 0, tasks: 0, shots: 0 })
    expect(cascadeSceneOrShotDelete(b, 'scene', null)).toEqual({ items: 0, tasks: 0, shots: 0 })
    expect(cascadeSceneOrShotDelete(b, 'scene', '')).toEqual({ items: 0, tasks: 0, shots: 0 })
    expect(b).toEqual(bundle())
  })

  it('a shot answers exactly as the links sweep does, and deletes no other shot', () => {
    const b = bundle()
    expect(cascadeSceneOrShotDelete(b, 'shot', 'sh-1')).toEqual({ items: 1, tasks: 1 })
    expect(b.shots).toHaveLength(4) // the row itself is the factory's to remove
    expect(() => cascadeSceneOrShotDelete(b, 'level', 'x')).toThrow(/kind/)
  })

  it('tolerates a bundle with no shots or tasks array', () => {
    expect(cascadeSceneOrShotDelete({}, 'scene', 'sc-1')).toEqual({ items: 0, tasks: 0, shots: 0 })
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
    const listId = backfillListId(PID)
    expect(b.shotLists).toEqual([{
      id: listId, project_id: PID, workspace_id: null, title: 'Shot list 1', version: 1,
      summary: 'Created from existing scenes', snapshot: {}, archived_at: null, archived_by: null,
      created_at: T0, created_by: null, updated_at: T0, updated_by: null,
    }])
    expect(b.project.active_shot_list_id).toBe(listId)
    expect(b.edits).toEqual([])
    expect(b.shotListItems.map(i => [i.scene_id || i.shot_id, i.position])).toEqual([
      ['sc-a', 0], ['sc-b', 1], ['sc-null', 2], // scene_number, nulls last
      ['sh-a1', 0], ['sh-a2', 1], // shots within their scene, by number
      ['sh-b1', 0],
      ['sh-loose', 0], // the unlinked bucket restarts at 0
    ])
    for (const i of b.shotListItems) {
      expect(Object.keys(i).sort()).toEqual(ITEM_KEYS)
      expect(i).toMatchObject({ shot_list_id: listId, project_id: PID, workspace_id: null })
      expect(i.id).toBe(backfillItemId(PID, i.scene_id || i.shot_id))
    }
    expect(n).toBe(0) // the project id is known, so newId is never asked
  })

  it('addendum H: the ids are DERIVED — sha1 of the addendum\'s names, as v5-style UUIDs', () => {
    // Restated from the addendum's text with node:crypto, so a changed prefix
    // or separator in the module fails here.
    const v5 = (name) => {
      const h = createHash('sha1').update(name, 'utf8').digest()
      h[6] = (h[6] & 0x0f) | 0x50
      h[8] = (h[8] & 0x3f) | 0x80
      const x = h.subarray(0, 16).toString('hex')
      return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
    }
    expect(backfillListId(PID)).toBe(v5(`wilson-shot-list:${PID}`))
    expect(backfillItemId(PID, 'sc-a')).toBe(v5(`wilson-shot-list-item:${PID}:sc-a`))
    const UUID5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(backfillListId(PID)).toMatch(UUID5)
    expect(backfillItemId(PID, 'sc-a')).toMatch(UUID5)
  })

  it('addendum H FAILING CONTROL: two fresh backfills of the same bundle mint the SAME ids; another project mints others', () => {
    const one = legacy()
    const two = legacy()
    backfillShotListsOnRead(one, { newId, now: T0 })
    backfillShotListsOnRead(two, { newId, now: T0 })
    expect(two.shotLists[0].id).toBe(one.shotLists[0].id)
    expect(two.shotListItems.map(i => i.id)).toEqual(one.shotListItems.map(i => i.id))
    expect(new Set(one.shotListItems.map(i => i.id)).size).toBe(one.shotListItems.length) // distinct per item
    const other = { ...legacy(), project: { id: 'p2', title: 'Other' } }
    backfillShotListsOnRead(other, { newId, now: T0 })
    expect(other.shotLists[0].id).not.toBe(one.shotLists[0].id)
    expect(other.shotListItems[0].id).not.toBe(one.shotListItems[0].id)
  })

  it('the URL\'s project id wins over the bundle\'s; newId is only the fallback for a bundle with no id at all', () => {
    const b = legacy()
    backfillShotListsOnRead(b, { newId, now: T0, projectId: 'from-url' })
    expect(b.shotLists[0].id).toBe(backfillListId('from-url'))
    const anon = { project: { title: 'no id' }, scenes: [{ id: 'sc-1' }] }
    backfillShotListsOnRead(anon, { newId, now: T0 })
    expect(anon.shotLists[0].id).toBe('bf-1')
    expect(() => backfillShotListsOnRead({ project: {}, scenes: [{ id: 'x' }] }, { now: T0 })).toThrow(/project id/)
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

// ── addendum H: dangling items are pruned on read ───────────────────────────
//
// R1 local#1: a build older than S3a (sharing rabbit-data) deletes a scene
// without the rule-8 sweep; its item then named nothing, and every membership
// write to that list was refused as "not in this project" — a new scene was
// saved but never joined the active list, invisible under D10.
describe('addendum H — pruneDanglingShotListItems', () => {
  function bundle() {
    return {
      shotLists: [list('L1'), list('L2', { archived_at: T0 })],
      scenes: [{ id: 'sc-1' }],
      shots: [{ id: 'sh-1', scene_id: 'sc-1' }],
      shotListItems: [
        item('i1', 'L1', { scene: 'sc-1' }), item('i2', 'L1', { shot: 'sh-1' }),
        item('gone-scene', 'L1', { scene: 'sc-gone' }), item('gone-shot', 'L2', { shot: 'sh-gone' }),
      ],
    }
  }

  it('drops items naming a missing scene or shot — in archived lists too — and says how many', () => {
    const b = bundle()
    expect(pruneDanglingShotListItems(b)).toBe(2)
    expect(b.shotListItems.map(i => i.id)).toEqual(['i1', 'i2'])
  })

  it('FAILING CONTROL: a bundle with nothing dangling is untouched and answers 0 (so a read does not rewrite it)', () => {
    const b = bundle()
    b.shotListItems = b.shotListItems.slice(0, 2)
    const arr = b.shotListItems
    expect(pruneDanglingShotListItems(b)).toBe(0)
    expect(b.shotListItems).toBe(arr) // not even a new array
  })

  it('never judges what it cannot see: no scenes array keeps scene items; a malformed item naming nothing stays; ids compare as text', () => {
    const noScenes = { shots: [], shotListItems: [item('i1', 'L1', { scene: 'sc-x' }), item('i2', 'L1', { shot: 'sh-x' })] }
    expect(pruneDanglingShotListItems(noScenes)).toBe(1)
    expect(noScenes.shotListItems.map(i => i.id)).toEqual(['i1'])
    const odd = { scenes: [{ id: 7 }], shots: [], shotListItems: [{ id: 'm', shot_list_id: 'L1' }, { id: 'n', scene_id: '7' }, null] }
    expect(pruneDanglingShotListItems(odd)).toBe(0)
    expect(pruneDanglingShotListItems({})).toBe(0)
  })

  it('the routes prune before validating, so a dangling row no longer blocks a write — and the write persists the prune', async () => {
    seed({
      shotLists: [list('L1')],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }, 0), item('gone', 'L1', { scene: 'sc-gone' }, 1)],
    })
    const r = await POST('/shot-lists/L1/items', { items: [{ scene_id: 'sc-2', position: 2 }] })
    expect(r.status).toBe(200)
    expect(disk().shotListItems.map(i => i.id)).toEqual(['i1', 'id-0001'])
  })
})

// ── rule 9 through main.cjs's readRabbitBundle (lifted) ─────────────────────
//
// The pure functions above could be right and main.cjs could still never call
// them, or call them without marking the bundle dirty — the backfill would
// then re-run on every read with fresh ids. This replays the real function
// over a fake disk.
describe('rule 9 — readRabbitBundle backfills a legacy bundle once and persists it', () => {
  // `failWrites` makes the first N writeJSON calls throw, as an AV / OneDrive
  // lock or a read-only copied demo folder does (R1 local#3).
  function replayRead(initial, { failWrites = 0 } = {}) {
    const files = new Map([['/fake/p1/project.json', JSON.stringify(initial)]])
    const diskWrites = []
    const mirrors = []
    let ids = 0
    let failures = failWrites
    // eslint-disable-next-line no-new-func
    const read = new Function(
      'rabbitBundlePath', 'readJSON', 'writeJSON', 'fileSlugify', 'localDemoRootDir', 'isPathInside', 'fs', 'path',
      'localDemoProjectsDir', 'rabbitLogFileEvent', 'ensureProjectFolders', 'ensureProjectFolderRows',
      'materializeFolderDirs', 'uuidv4', 'backfillShotListsOnRead', 'ensureShotListKeys',
      'pruneDanglingShotListItems', 'mirrorProjectDatabases',
      `${extractFunction(MAIN_CJS, 'readRabbitBundle')}
       return readRabbitBundle;`,
    )(
      (id) => `/fake/${id}/project.json`,
      (file, fallback) => (files.has(file) ? JSON.parse(files.get(file)) : fallback),
      (file, data) => {
        if (failures > 0) { failures--; throw new Error('EBUSY: resource busy or locked') }
        files.set(file, JSON.stringify(data)); diskWrites.push(file)
      },
      (s) => s, () => null, () => false, { existsSync: () => false }, path,
      () => '/fake/projects', () => {}, () => {}, () => false, () => {},
      () => `rid-${++ids}`, backfillShotListsOnRead, ensureShotListKeys,
      pruneDanglingShotListItems,
      (projectId, bundle) => { mirrors.push({ projectId, shotLists: structuredClone(bundle.shotLists) }) },
    )
    return { read, diskWrites, files, mirrors }
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
    const { read, diskWrites, mirrors } = replayRead({ ...FULL(), shotLists: [], shotListItems: [], edits: [] })
    const b = read(PID)
    expect(b.shotLists).toEqual([])
    expect(diskWrites).toHaveLength(0)
    expect(mirrors).toHaveLength(0)
  })

  it('a bundle with shotLists but no siblings gains them, persisted, with no list', () => {
    const { read, diskWrites, mirrors } = replayRead({ ...FULL(), shotLists: [] })
    const b = read(PID)
    expect(b.shotListItems).toEqual([])
    expect(b.edits).toEqual([])
    expect(b.shotLists).toEqual([])
    expect(diskWrites).toHaveLength(1)
    expect(mirrors).toHaveLength(0) // not a backfill: no mirror
  })

  it('addendum H: a backfilling read mirrors ONCE (scenes.json appears); the next read, and every current bundle, does not', () => {
    // GET /api/rabbit/projects reads every project's bundle; a mirror per
    // project per list would rewrite six files each for nothing.
    const { read, mirrors } = replayRead(FULL())
    const first = read(PID)
    expect(mirrors).toEqual([{ projectId: PID, shotLists: first.shotLists }])
    read(PID)
    read(PID)
    expect(mirrors).toHaveLength(1)
  })

  it('addendum H FAILING CONTROL: a read whose write-back FAILED is re-derived with the SAME ids by the next read', () => {
    // R1 local#3's replay: with random ids, read #1 handed the renderer list
    // A while read #2 persisted list B, and set-active(A) answered 404.
    const { read, diskWrites, mirrors } = replayRead(FULL(), { failWrites: 1 })
    const first = read(PID)
    expect(diskWrites).toHaveLength(0) // the write threw and was swallowed
    const second = read(PID)
    expect(diskWrites).toHaveLength(1)
    expect(second.shotLists[0].id).toBe(first.shotLists[0].id)
    expect(second.project.active_shot_list_id).toBe(first.project.active_shot_list_id)
    expect(second.shotListItems.map(i => i.id)).toEqual(first.shotListItems.map(i => i.id))
    expect(read(PID).shotLists[0].id).toBe(first.shotLists[0].id) // and it is what persisted
    expect(mirrors).toHaveLength(2) // the backfill ran twice, so did its mirror — same ids both times
  })

  it('addendum H: a dangling item is pruned on read and persisted once, with no mirror', () => {
    const { read, diskWrites, mirrors, files } = replayRead({
      ...FULL(),
      shotLists: [list('L1')], edits: [],
      shotListItems: [item('i1', 'L1', { scene: 'sc-1' }), item('gone', 'L1', { shot: 'sh-deleted-by-an-old-build' })],
    })
    expect(read(PID).shotListItems.map(i => i.id)).toEqual(['i1'])
    expect(diskWrites).toHaveLength(1)
    expect(JSON.parse(files.get('/fake/p1/project.json')).shotListItems.map(i => i.id)).toEqual(['i1'])
    read(PID)
    expect(diskWrites).toHaveLength(1) // converged
    expect(mirrors).toHaveLength(0)
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
