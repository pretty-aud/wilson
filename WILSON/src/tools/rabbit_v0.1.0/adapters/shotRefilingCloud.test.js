// =============================================================================
// shotRefilingCloud.test.js — post-overhaul S4c: the Supabase adapter's half
// of the shot-folder re-filing, on a fake client that keeps tables and two
// buckets in memory and LOGS every call in order.
//
// The order is what matters most: an object is moved in its bucket and seen
// at its new key BEFORE the files row is rewritten, the thumbnail follows
// its body, and the folder row is re-parented only after every file of the
// shot. A move that does not land leaves the row as it was; a row update
// that is refused after a verified move puts the object back; a body in the
// customer's own bucket or on another computer leaves its shot where it is,
// with the reason; a second run finds nothing to move. Also the nested
// upload key, and ensureEntityFolder's nesting on this adapter.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))
vi.mock('../../../cloud/workspaceStorage', () => ({
  getWorkspaceStorageCached: async () => globalThis.__testStorageRow ?? { mode: 'central', provider: 'petal' },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => globalThis.__testLocalServer === true,
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')
const { registerStorageProvider, FILE_PROVIDERS } = await import('../storage')

const PID = 'aaaa1111-0000-0000-0000-000000000001'
const project = { id: PID, title: 'Fixture', scenes_enabled: true }

/** A LIKE pattern as a RegExp: `%` any run, `_` any one character, backslash escapes. */
function likeToRegExp(pattern) {
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) { out += esc(pattern[++i]); continue }
    if (c === '%') { out += '.*'; continue }
    if (c === '_') { out += '.'; continue }
    out += esc(c)
  }
  return new RegExp(out + '$')
}

/**
 * Tables and two buckets in memory; `log` records every call in order.
 * Hooks: failMove(bucket, from, to) → a message refuses the move;
 * failUpdate(table, patch, hits) → a message refuses the update, 'filtered'
 * applies nothing and answers NO ROW (an RLS-filtered update), and
 * 'committed:<msg>' applies it and answers the error (an answer lost on the
 * way back); failDelete(table, hits) → 'filtered' removes nothing and
 * answers no row; dropLanding(bucket, from, to) → true loses the object in
 * the move; onMove(bucket, from, to) runs after each move (something a
 * teammate does mid-run); failRead(table) → a message makes a SELECT answer
 * `{ data: null, error }` (a lost connection); failList(bucket, dir) → a
 * message makes a bucket list answer an error; `hidden` (a Set of ids) and
 * a `deleted_at` on a files row are what RLS hides from a SELECT
 * (files_select, 0014) — an update or delete still reaches them, as the
 * database's own USING does not read deleted_at. A ranged SELECT with no
 * ORDER answers in a different rotation each call, as Postgres may.
 */
function makeClient({ tables, objects, failMove = () => null, failUpdate = () => null, failDelete = () => null, dropLanding = () => false, onMove = () => {}, failRead = () => null, failList = () => null, hidden = new Set() } = {}) {
  const log = []
  let seq = 0
  let rotateSeq = 0
  const table = (name) => {
    const state = { op: 'select', filters: [], payload: null, single: false, maybe: false, count: null, head: false, returning: false, order: null, range: null }
    const b = {
      select(cols, opts) {
        if (state.op !== 'select') state.returning = true
        if (opts && opts.count) { state.count = opts.count; state.head = !!opts.head }
        return b
      },
      order(col) { state.order = col; return b },
      limit() { return b },
      range(from, to) { state.range = [from, to]; return b },
      eq(col, v) { state.filters.push(r => String(r[col]) === String(v)); return b },
      is(col, v) { state.filters.push(r => r[col] === v); return b },
      like(col, pattern) { const re = likeToRegExp(pattern); state.filters.push(r => typeof r[col] === 'string' && re.test(r[col])); return b },
      // PostgREST's `or=(a.like.x,b.like.y)` as supabase-js sends it; only
      // `like` is read here, which is all the adapter uses.
      or(expr) {
        const parts = expr.split(',').map(s => { const [col, op, ...rest] = s.trim().split('.'); return { col, op, re: likeToRegExp(rest.join('.')) } })
        state.filters.push(r => parts.some(p => p.op === 'like' && typeof r[p.col] === 'string' && p.re.test(r[p.col])))
        return b
      },
      not(col, op, v) { if (op === 'is' && v === null) state.filters.push(r => r[col] != null); return b },
      single() { state.single = true; return b },
      maybeSingle() { state.maybe = true; return b },
      insert(row) { state.op = 'insert'; state.payload = row; return b },
      update(row) { state.op = 'update'; state.payload = row; return b },
      delete() { state.op = 'delete'; return b },
      then(resolve, reject) {
        if (!tables[name]) tables[name] = []
        const rows = tables[name]
        const match = (r) => state.filters.every(f => f(r))
        const oneOrAll = (hits) => (state.single || state.maybe ? (hits[0] ? { ...hits[0] } : null) : hits.map(h => ({ ...h })))
        let result
        if (state.op === 'select') {
          const refusedRead = failRead(name)
          if (refusedRead) return Promise.resolve({ data: null, error: { message: refusedRead } }).then(resolve, reject)
          let hits = rows.filter(match).filter(r => !(name === 'files' && (r.deleted_at || hidden.has(r.id)))).map(r => ({ ...r }))
          if (state.order) hits.sort((a, c) => String(a[state.order]).localeCompare(String(c[state.order])))
          else if (state.range && hits.length > 1) { const k = (rotateSeq++) % hits.length; hits = [...hits.slice(k), ...hits.slice(0, k)] }
          if (state.count) result = { data: state.head ? null : hits, count: hits.length, error: null }
          else {
            if (state.range) hits = hits.slice(state.range[0], state.range[1] + 1)
            if (state.single) result = hits[0] ? { data: hits[0], error: null } : { data: null, error: { message: 'no rows' } }
            else if (state.maybe) result = { data: hits[0] || null, error: null }
            else result = { data: hits, error: null }
          }
        } else if (state.op === 'insert') {
          const row = { id: `new-${++seq}`, ...state.payload }
          rows.push(row)
          log.push(['insert', name, row.path || row.name || row.id])
          result = { data: { ...row }, error: null }
        } else if (state.op === 'update') {
          const hits = rows.filter(match)
          const refused = failUpdate(name, state.payload, hits)
          if (refused === 'filtered') {
            log.push(['update-refused', name, hits.map(h => h.id)])
            result = { data: state.single || state.maybe ? null : [], error: null }
          } else {
            const committed = !refused || String(refused).startsWith('committed:')
            if (committed) for (const r of hits) Object.assign(r, state.payload)
            log.push([refused ? 'update-refused' : 'update', name, hits.map(h => h.id), { ...state.payload }])
            const err = refused ? { message: String(refused).replace(/^committed:/, '') } : (state.single && !hits[0] ? { message: 'no rows' } : null)
            result = err ? { data: null, error: err } : { data: oneOrAll(hits), error: null }
          }
        } else if (state.op === 'delete') {
          const hits = rows.filter(match)
          const filtered = failDelete(name, hits) === 'filtered'
          if (!filtered) for (const h of hits) rows.splice(rows.indexOf(h), 1)
          log.push(['delete', name, filtered ? [] : hits.map(h => h.id)])
          result = { data: state.returning ? (filtered ? [] : hits.map(h => ({ id: h.id }))) : null, error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  const storage = {
    from: (bucket) => ({
      list: async (dir, opts) => {
        log.push(['list', bucket, dir, opts?.search])
        const refused = failList(bucket, dir)
        if (refused) return { data: null, error: { message: refused } }
        const keys = [...(objects[bucket] || [])]
          .filter(k => k.startsWith(`${dir}/`))
          .map(k => k.slice(dir.length + 1))
          .filter(leaf => !leaf.includes('/') && (!opts?.search || leaf.includes(opts.search)))
        return { data: keys.map(name => ({ name })), error: null }
      },
      move: async (from, to) => {
        log.push(['move', bucket, from, to])
        const refused = failMove(bucket, from, to)
        if (refused) return { data: null, error: { message: refused } }
        if (!objects[bucket].has(from)) return { data: null, error: { message: 'Object not found' } }
        objects[bucket].delete(from)
        if (!dropLanding(bucket, from, to)) objects[bucket].add(to)
        onMove(bucket, from, to)
        return { data: { message: 'Successfully moved' }, error: null }
      },
    }),
  }
  return {
    log, tables, objects,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: table,
    storage,
    rpc: async () => ({ data: null, error: null }),
  }
}

const folder = (id, kind, pathStr, parentId, extra = {}) => ({ id, project_id: PID, parent_id: parentId, kind, entity_type: extra.entity_type || null, slug: pathStr.split('/').pop(), label: null, path: pathStr, ...extra })
const fileRow = (id, name, shotId, folderId, extra = {}) => ({
  id, project_id: PID, name, shot_id: shotId, folder_id: folderId, storage_provider: 'supabase',
  storage_path: `projects/${PID}/shots/${shotId}/1-${name}`, thumbnail_url: null, deleted_at: null, ...extra,
})

function fixture() {
  const tables = {
    projects: [{ id: PID, is_private: false }],
    scenes: [{ id: 'sc1', name: 'Lighthouse, dawn', project_id: PID }, { id: 'sc2', name: 'Cliff path', project_id: PID }],
    shots: [{ id: 'sh1', name: 'The door', scene_id: 'sc1', project_id: PID }, { id: 'sh2', name: 'The cold lamp', scene_id: 'sc1', project_id: PID }, { id: 'sh3', name: 'Loose', scene_id: null, project_id: PID }],
    folders: [
      folder('r', 'root', '', null),
      folder('c-scenes', 'category', 'SCENES', 'r', { entity_type: 'scene' }),
      folder('c-shots', 'category', 'SHOTS', 'r', { entity_type: 'shot' }),
      folder('f-sc1', 'entity', 'SCENES/Lighthouse-Dawn', 'c-scenes', { entity_type: 'scene', scene_id: 'sc1' }),
      folder('f-sh1', 'entity', 'SHOTS/The-Door', 'c-shots', { entity_type: 'shot', shot_id: 'sh1' }),
      folder('f-sh2', 'entity', 'SHOTS/The-Cold-Lamp', 'c-shots', { entity_type: 'shot', shot_id: 'sh2' }),
    ],
    files: [
      fileRow('f1', 'plate.exr', 'sh1', 'f-sh1', { thumbnail_url: `projects/${PID}/shots/sh1/1-plate.exr.jpg` }),
      fileRow('f2', 'old.png', 'sh1', 'f-sh1', { deleted_at: '2026-09-01T00:00:00Z' }),
      fileRow('f3', 'board.png', 'sh2', 'f-sh2'),
    ],
  }
  const objects = {
    'rabbit-files': new Set([`projects/${PID}/shots/sh1/1-plate.exr`, `projects/${PID}/shots/sh2/1-board.png`]),
    'rabbit-thumbnails': new Set([`projects/${PID}/shots/sh1/1-plate.exr.jpg`]),
  }
  return { tables, objects }
}

const NEW = {
  plate: `projects/${PID}/scenes/sc1/sh1/1-plate.exr`,
  plateThumb: `projects/${PID}/scenes/sc1/sh1/1-plate.exr.jpg`,
  board: `projects/${PID}/scenes/sc1/sh2/1-board.png`,
}

let localObjects
function fakeLocalProvider() {
  return {
    put: async () => {}, get: async () => new Blob(['x']), del: async () => {}, describe: async () => ({}),
    exists: async (key) => localObjects.has(key),
    move: async (from, to) => { if (!localObjects.has(from)) throw new Error('not here'); localObjects.delete(from); localObjects.add(to) },
  }
}

beforeEach(() => {
  resetSupabaseAdapter()
  localObjects = new Set()
  registerStorageProvider(FILE_PROVIDERS.SUPABASE, { put: async () => {}, get: async () => new Blob(['x']), del: async () => {}, exists: async () => true, describe: async () => ({}) })
  registerStorageProvider(FILE_PROVIDERS.S3, { put: async () => {}, get: async () => new Blob(['x']), del: async () => {}, exists: async () => true, describe: async () => ({}) })
  registerStorageProvider(FILE_PROVIDERS.LOCAL_SERVER, fakeLocalProvider())
  globalThis.__testLocalServer = false
})
afterEach(() => { resetSupabaseAdapter(); delete globalThis.__testSupabase; delete globalThis.__testLocalServer })

const run = (client, opts) => { globalThis.__testSupabase = client; return supabaseAdapter().refileShotFolders(PID, project, opts) }
const indexOf = (log, pred) => log.findIndex(pred)

describe('refileShotFolders: the happy path and its order', () => {
  it('moves each object in both buckets, sees it there, THEN rewrites the row; the folder row goes under the scene only after every file; the empty SHOTS category goes last', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects })
    const progress = []
    const res = await run(client, { onProgress: (p) => progress.push([p.name, p.done, p.total]) })
    expect(res.left).toEqual([])
    expect(res.moved.map(m => [m.name, m.to, m.files])).toEqual([
      ['The-Cold-Lamp', 'SCENES/Lighthouse-Dawn/The-Cold-Lamp', 1],
      ['The-Door', 'SCENES/Lighthouse-Dawn/The-Door', 1],
    ])
    expect(res.removedShotsCategory).toBe(true)
    expect(progress).toEqual([['The-Cold-Lamp', 0, 2], ['The-Door', 1, 2]])
    // The buckets: nested keys, nothing at the old ones, the purged trash row's object untouched (it had none).
    expect([...objects['rabbit-files']].sort()).toEqual([NEW.board, NEW.plate].sort())
    expect([...objects['rabbit-thumbnails']]).toEqual([NEW.plateThumb])
    // The rows.
    const f1 = tables.files.find(f => f.id === 'f1')
    expect([f1.storage_path, f1.thumbnail_url]).toEqual([NEW.plate, NEW.plateThumb])
    expect(tables.files.find(f => f.id === 'f2').storage_path).toBe(`projects/${PID}/shots/sh1/1-old.png`)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    const door = tables.folders.find(f => f.id === 'f-sh1')
    expect([door.path, door.parent_id]).toEqual(['SCENES/Lighthouse-Dawn/The-Door', 'f-sc1'])
    expect(tables.folders.some(f => f.path === 'SHOTS')).toBe(false)
    expect(tables.folders.some(f => f.path.startsWith('SHOTS/'))).toBe(false)
    // THE ORDER, for the door's plate (review round 1: the row follows EACH
    // object at once, so no object is left moved with its row saying the
    // old key for longer than one round trip): move body → see it → update
    // the row's storage_path → move thumb → see it → update the row's
    // thumbnail_url → update the folder → delete the category.
    const log = client.log
    const moveBody = indexOf(log, e => e[0] === 'move' && e[1] === 'rabbit-files' && e[3] === NEW.plate)
    const seeBody = indexOf(log, e => e[0] === 'list' && e[1] === 'rabbit-files' && e[2] === `projects/${PID}/scenes/sc1/sh1` && e[3] === '1-plate.exr' && log.indexOf(e) > moveBody)
    const rowBody = indexOf(log, e => e[0] === 'update' && e[1] === 'files' && e[2].includes('f1') && e[3].storage_path === NEW.plate)
    const moveThumb = indexOf(log, e => e[0] === 'move' && e[1] === 'rabbit-thumbnails')
    const seeThumb = indexOf(log, e => e[0] === 'list' && e[1] === 'rabbit-thumbnails' && e[3] === '1-plate.exr.jpg' && log.indexOf(e) > moveThumb)
    const rowThumb = indexOf(log, e => e[0] === 'update' && e[1] === 'files' && e[2].includes('f1') && e[3].thumbnail_url === NEW.plateThumb)
    const folderUpdate = indexOf(log, e => e[0] === 'update' && e[1] === 'folders' && e[2].includes('f-sh1'))
    const categoryDelete = indexOf(log, e => e[0] === 'delete' && e[1] === 'folders' && e[2].includes('c-shots'))
    for (const i of [moveBody, seeBody, rowBody, moveThumb, seeThumb, rowThumb, folderUpdate, categoryDelete]) expect(i).toBeGreaterThanOrEqual(0)
    expect(moveBody).toBeLessThan(seeBody)
    expect(seeBody).toBeLessThan(rowBody)
    expect(rowBody).toBeLessThan(moveThumb)
    expect(moveThumb).toBeLessThan(seeThumb)
    expect(seeThumb).toBeLessThan(rowThumb)
    expect(rowThumb).toBeLessThan(folderUpdate)
    expect(folderUpdate).toBeLessThan(categoryDelete)
    // The body's row is never written with the thumbnail's key, nor the
    // other way round: one column per update, each after its own object.
    expect(log.filter(e => e[0] === 'update' && e[1] === 'files').map(e => [e[2][0], Object.keys(e[3]).join()])).toEqual([
      ['f3', 'storage_path'], ['f1', 'storage_path'], ['f1', 'thumbnail_url'],
    ])
    // Nothing of the shot moved before the shot was checked whole: the
    // door's PICTURE was looked for at its new key before the door's BODY
    // moved (the pre-flight; the move's own look comes after).
    const thumbChecked = indexOf(log, e => e[0] === 'list' && e[1] === 'rabbit-thumbnails' && e[2] === `projects/${PID}/scenes/sc1/sh1` && e[3] === '1-plate.exr.jpg')
    expect(thumbChecked).toBeGreaterThanOrEqual(0)
    expect(thumbChecked).toBeLessThan(moveBody)
  })

  it('is idempotent: a second run moves nothing, touches no object, and the category is already gone', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects })
    await run(client)
    client.log.length = 0
    const again = await run(client)
    expect(again).toEqual({ moved: [], left: [], removedShotsCategory: false })
    expect(client.log.filter(e => e[0] === 'move' || e[0] === 'update' || e[0] === 'delete')).toEqual([])
  })

  it('keeps SHOTS while a shot with no scene still has a folder under it', async () => {
    const { tables, objects } = fixture()
    tables.folders.push(folder('f-sh3', 'entity', 'SHOTS/Loose', 'c-shots', { entity_type: 'shot', shot_id: 'sh3' }))
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.moved).toHaveLength(2)
    expect(res.removedShotsCategory).toBe(false)
    expect(tables.folders.some(f => f.path === 'SHOTS')).toBe(true)
    expect(tables.folders.find(f => f.id === 'f-sh3').path).toBe('SHOTS/Loose')
  })

  it('makes the scene\'s folder row first when the scene has none, and parents the shot on it', async () => {
    const { tables, objects } = fixture()
    tables.folders = tables.folders.filter(f => f.id !== 'f-sc1')
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    const scene = tables.folders.find(f => f.scene_id === 'sc1')
    expect(scene.path).toBe('SCENES/Lighthouse-Dawn')
    expect(tables.folders.find(f => f.id === 'f-sh1').parent_id).toBe(scene.id)
    expect(indexOf(client.log, e => e[0] === 'insert' && e[1] === 'folders' && e[2] === 'SCENES/Lighthouse-Dawn'))
      .toBeLessThan(indexOf(client.log, e => e[0] === 'move'))
  })
})

describe('refileShotFolders: when something goes wrong, the rows stay true', () => {
  it('an object that does not land leaves its row and its shot as they were, with the reason; the other shot still moves', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects, dropLanding: (bucket, from) => from.endsWith('1-board.png') })
    const res = await run(client)
    expect(res.moved.map(m => m.name)).toEqual(['The-Door'])
    expect(res.left).toHaveLength(1)
    expect(res.left[0].name).toBe('The-Cold-Lamp')
    expect(res.left[0].reason).toContain('did not arrive')
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(`projects/${PID}/shots/sh2/1-board.png`)
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
    expect(client.log.some(e => e[0] === 'update' && e[1] === 'files' && e[2].includes('f3'))).toBe(false)
    expect(res.removedShotsCategory).toBe(false)
  })

  it('a row update refused after a verified move puts the object (and its thumbnail) back, and the shot is left with the reason', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects, failUpdate: (name, patch) => (name === 'files' && patch.storage_path === NEW.plate ? 'permission denied for table files' : null) })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('could not be re-filed')
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh1/1-plate.exr`)).toBe(true)
    expect(objects['rabbit-files'].has(NEW.plate)).toBe(false)
    expect(objects['rabbit-thumbnails'].has(`projects/${PID}/shots/sh1/1-plate.exr.jpg`)).toBe(true)
    expect(tables.files.find(f => f.id === 'f1').storage_path).toBe(`projects/${PID}/shots/sh1/1-plate.exr`)
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    // The other shot still moved.
    expect(res.moved.map(m => m.name)).toEqual(['The-Cold-Lamp'])
  })

  it('a thumbnail that cannot follow its body leaves the body MOVED with its row saying so (nothing is put back), the shot left with the reason; the next run moves the picture alone and finishes the shot', async () => {
    const { tables, objects } = fixture()
    let down = true
    const client = makeClient({ tables, objects, failMove: (bucket) => (bucket === 'rabbit-thumbnails' && down ? 'thumbnails bucket down' : null) })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('thumbnails bucket down')
    // Round 1 (item 1): the old code moved the body back after its row had
    // been... no — its row had NOT been written yet, and a stop between the
    // two left an object no row named. Now the row follows the body at
    // once, and the body stays where its row says.
    expect(objects['rabbit-files'].has(NEW.plate)).toBe(true)
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh1/1-plate.exr`)).toBe(false)
    const f1 = tables.files.find(f => f.id === 'f1')
    expect([f1.storage_path, f1.thumbnail_url]).toEqual([NEW.plate, `projects/${PID}/shots/sh1/1-plate.exr.jpg`])
    expect(objects['rabbit-thumbnails'].has(`projects/${PID}/shots/sh1/1-plate.exr.jpg`)).toBe(true)
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
    // The next run: the row is found by its PICTURE's key (the body is
    // nested already), the picture moves, the row says so, the folder goes.
    down = false
    client.log.length = 0
    const again = await run(client)
    expect(again.left).toEqual([])
    expect(again.moved.map(m => [m.name, m.files])).toEqual([['The-Door', 1]])
    expect([f1.storage_path, f1.thumbnail_url]).toEqual([NEW.plate, NEW.plateThumb])
    expect(client.log.filter(e => e[0] === 'move').map(e => e[1])).toEqual(['rabbit-thumbnails'])
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dawn/The-Door')
  })

  it('a thumbnail at NEITHER key is a derived picture: the row stops naming it and the shot still moves', async () => {
    const { tables, objects } = fixture()
    objects['rabbit-thumbnails'].clear()
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    const f1 = tables.files.find(f => f.id === 'f1')
    expect([f1.storage_path, f1.thumbnail_url]).toEqual([NEW.plate, null])
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dawn/The-Door')
  })

  it('resumes: an object already at its new key with none at the old (a move that landed on an earlier run) is counted done and its row is rewritten', async () => {
    const { tables, objects } = fixture()
    objects['rabbit-files'].delete(`projects/${PID}/shots/sh2/1-board.png`)
    objects['rabbit-files'].add(NEW.board)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.moved.find(m => m.name === 'The-Cold-Lamp').files).toBe(1)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    expect(client.log.some(e => e[0] === 'move' && e[3] === NEW.board)).toBe(false)
  })

  it('an object at BOTH keys is left alone (nothing is ever overwritten or deleted), and its shot with it — found BEFORE any object of the shot moves', async () => {
    const { tables, objects } = fixture()
    objects['rabbit-files'].add(NEW.board)
    // A second file on the same shot, listed first: it must not move either.
    tables.files.push(fileRow('f0', 'a-first.png', 'sh2', 'f-sh2'))
    objects['rabbit-files'].add(`projects/${PID}/shots/sh2/1-a-first.png`)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Cold-Lamp'])
    expect(res.left[0].reason).toContain('exists at both')
    expect(objects['rabbit-files'].has(NEW.board)).toBe(true)
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh2/1-board.png`)).toBe(true)
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh2/1-a-first.png`)).toBe(true)
    expect(client.log.some(e => e[0] === 'move' && e[2].includes('/sh2/'))).toBe(false)
    expect(tables.files.find(f => f.id === 'f0').storage_path).toBe(`projects/${PID}/shots/sh2/1-a-first.png`)
  })

  // ── Review round 1: what the first version got wrong ──────────────────
  it('a LIVE row whose body is at neither key refuses the whole shot before any object moves, naming the file (S4c-03); a decoy leaf next to it is not the file', async () => {
    const { tables, objects } = fixture()
    // The door gains a live row with no body — and a neighbour whose name
    // CONTAINS the missing leaf (round 1's mutant: a `search` is a substring
    // match, and `length > 0` would have taken the neighbour for the file).
    tables.files.push(fileRow('f4', 'lost.mov', 'sh1', 'f-sh1'))
    objects['rabbit-files'].add(`projects/${PID}/shots/sh1/1-lost.mov.bak`)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.moved.map(m => m.name)).toEqual(['The-Cold-Lamp'])
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('“lost.mov” is missing from rabbit-files')
    // Nothing of the door moved — the plate is where it was, its row too.
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh1/1-plate.exr`)).toBe(true)
    expect(tables.files.find(f => f.id === 'f1').storage_path).toBe(`projects/${PID}/shots/sh1/1-plate.exr`)
    expect(client.log.some(e => e[0] === 'move' && e[2].includes('/sh1/'))).toBe(false)
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SHOTS/The-Door')
  })

  it('a folder row already at the destination refuses the shot before any object moves', async () => {
    const { tables, objects } = fixture()
    tables.folders.push(folder('custom', 'custom', 'SCENES/Lighthouse-Dawn/The-Door', 'f-sc1'))
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left.map(l => [l.name, l.reason])).toEqual([['The-Door', 'a folder already sits at SCENES/Lighthouse-Dawn/The-Door']])
    expect(client.log.some(e => e[0] === 'move' && e[2].includes('/sh1/'))).toBe(false)
    expect(res.moved.map(m => m.name)).toEqual(['The-Cold-Lamp'])
  })

  it('an update that COMMITTED but lost its answer is left as it committed: the row is read again, the object is NOT moved back', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects, failUpdate: (name, patch) => (name === 'files' && patch.storage_path === NEW.board ? 'committed:fetch timed out' : null) })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.moved.map(m => [m.name, m.files])).toEqual([['The-Cold-Lamp', 1], ['The-Door', 1]])
    expect(objects['rabbit-files'].has(NEW.board)).toBe(true)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    expect(client.log.filter(e => e[0] === 'move' && e[3].endsWith('1-board.png'))).toHaveLength(1)
  })

  it('an update that reaches NO ROW (the row trashed meanwhile is invisible to it, and to the read after) puts the object back and leaves the shot with the reason', async () => {
    const { tables, objects } = fixture()
    const hidden = new Set()
    const client = makeClient({
      tables, objects, hidden,
      failUpdate: (name, patch) => (name === 'files' && patch.storage_path === NEW.board ? 'filtered' : null),
      // Trashed the moment its body has moved: the update reaches no row,
      // and the row read again is not there either (`!now`).
      onMove: (bucket, from) => { if (from.endsWith('1-board.png')) hidden.add('f3') },
    })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Cold-Lamp'])
    expect(res.left[0].reason).toContain('not visible to this account')
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh2/1-board.png`)).toBe(true)
    expect(objects['rabbit-files'].has(NEW.board)).toBe(false)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(`projects/${PID}/shots/sh2/1-board.png`)
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
  })

  it('an update refused and a read that fails too: nothing is known, so nothing is moved back — the object stays at its new key, the shot says "run it again", and the next run counts it landed (round 2, item 4)', async () => {
    const { tables, objects } = fixture()
    let readsFail = false
    let refuseOnce = true
    const client = makeClient({
      tables, objects,
      failUpdate: (name, patch) => { if (refuseOnce && name === 'files' && patch.storage_path === NEW.board) { refuseOnce = false; readsFail = true; return 'fetch timed out' } return null },
      failRead: (name) => (readsFail && name === 'files' ? 'fetch timed out' : null),
    })
    const res = await run(client)
    const lamp = res.left.find(l => l.name === 'The-Cold-Lamp')
    expect(lamp.reason).toContain('could not be read back')
    expect(lamp.reason).toContain('run it again')
    expect(objects['rabbit-files'].has(NEW.board)).toBe(true)
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh2/1-board.png`)).toBe(false)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(`projects/${PID}/shots/sh2/1-board.png`)
    expect(client.log.filter(e => e[0] === 'move' && e[2] === NEW.board)).toHaveLength(0)
    // The link back: the row still names the old key, the object is at the
    // new one — landed earlier — and the row is rewritten this time.
    readsFail = false
    const again = await run(client)
    expect(again.left).toEqual([])
    // The door was left too on the first run (its rows could not be read);
    // both finish now.
    expect(again.moved.map(m => [m.name, m.files])).toEqual([['The-Cold-Lamp', 1], ['The-Door', 1]])
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
  })

  it('a bucket that cannot be listed is a fault, not an absence: the shot is left with it, and no thumbnail is cleared', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects, failList: (bucket) => (bucket === 'rabbit-thumbnails' ? 'bucket unavailable' : null) })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('storage list failed: bucket unavailable')
    const f1 = tables.files.find(f => f.id === 'f1')
    expect([f1.storage_path, f1.thumbnail_url]).toEqual([`projects/${PID}/shots/sh1/1-plate.exr`, `projects/${PID}/shots/sh1/1-plate.exr.jpg`])
    expect(client.log.some(e => e[0] === 'move' && e[2].includes('/sh1/'))).toBe(false)
  })

  it('a thumbnail at BOTH keys refuses the shot before any object moves, like a body at both', async () => {
    const { tables, objects } = fixture()
    objects['rabbit-thumbnails'].add(NEW.plateThumb)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('exists at both its old and its new place in rabbit-thumbnails')
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh1/1-plate.exr`)).toBe(true)
    expect(client.log.some(e => e[0] === 'move' && e[2].includes('/sh1/'))).toBe(false)
  })

  it('a folder update that reaches no row leaves the shot with the reason, its rows true; the next run finishes it', async () => {
    const { tables, objects } = fixture()
    let filtered = true
    const client = makeClient({ tables, objects, failUpdate: (name, patch) => (filtered && name === 'folders' && patch.parent_id ? 'filtered' : null) })
    const res = await run(client)
    expect(res.left.map(l => l.name).sort()).toEqual(['The-Cold-Lamp', 'The-Door'])
    expect(res.left[0].reason).toContain('reached no row')
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
    filtered = false
    const again = await run(client)
    expect(again.left).toEqual([])
    expect(again.moved.map(m => [m.name, m.files])).toEqual([['The-Cold-Lamp', 0], ['The-Door', 0]])
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SCENES/Lighthouse-Dawn/The-Cold-Lamp')
  })

  it('CONTROL: another project\'s folder under SHOTS does not keep this project\'s SHOTS', async () => {
    const { tables, objects } = fixture()
    tables.folders.push(folder('other-shots', 'entity', 'SHOTS/Other', 'other-c', { project_id: 'other-project', shot_id: 'shX' }))
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.removedShotsCategory).toBe(true)
    expect(tables.folders.find(f => f.id === 'other-shots').path).toBe('SHOTS/Other')
  })

  it('a row that lands under the old prefix mid-run keeps the folder where it is (the rows moved say where their files are); the next run takes it', async () => {
    const { tables, objects } = fixture()
    let landed = false
    const client = makeClient({
      tables, objects,
      onMove: (bucket, from) => {
        if (landed || !from.endsWith('1-board.png')) return
        landed = true
        tables.files.push(fileRow('f5', 'late.png', 'sh2', 'f-sh2'))
        objects['rabbit-files'].add(`projects/${PID}/shots/sh2/1-late.png`)
      },
    })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Cold-Lamp'])
    expect(res.left[0].reason).toContain('still under the old prefix')
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    expect(tables.files.find(f => f.id === 'f5').storage_path).toBe(`projects/${PID}/shots/sh2/1-late.png`)
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
    const again = await run(client)
    expect(again.left).toEqual([])
    expect(again.moved.map(m => [m.name, m.files])).toEqual([['The-Cold-Lamp', 1]])
    expect(tables.files.find(f => f.id === 'f5').storage_path).toBe(`projects/${PID}/scenes/sc1/sh2/1-late.png`)
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SCENES/Lighthouse-Dawn/The-Cold-Lamp')
  })

  it('a row is taken by its KEY, not its links: a row with only folder_id, and one with no link at all, move with the shot', async () => {
    const { tables, objects } = fixture()
    tables.files.push({ ...fileRow('f6', 'by-folder.png', null, 'f-sh2'), storage_path: `projects/${PID}/shots/sh2/1-by-folder.png` })
    tables.files.push({ ...fileRow('f7', 'no-link.png', null, null), storage_path: `projects/${PID}/shots/sh2/1-no-link.png` })
    objects['rabbit-files'].add(`projects/${PID}/shots/sh2/1-by-folder.png`)
    objects['rabbit-files'].add(`projects/${PID}/shots/sh2/1-no-link.png`)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.moved.find(m => m.name === 'The-Cold-Lamp').files).toBe(3)
    expect(tables.files.find(f => f.id === 'f6').storage_path).toBe(`projects/${PID}/scenes/sc1/sh2/1-by-folder.png`)
    expect(tables.files.find(f => f.id === 'f7').storage_path).toBe(`projects/${PID}/scenes/sc1/sh2/1-no-link.png`)
    // CONTROL: another shot's key under the same scene is not this shot's.
    expect(tables.files.find(f => f.id === 'f1').storage_path).toBe(NEW.plate)
  })

  it('reads whole, not the first page: 1,002 files on one shot all move, and 1,003 folder rows are all listed', async () => {
    const { tables, objects } = fixture()
    for (let i = 0; i < 1001; i++) {
      tables.files.push(fileRow(`m${i}`, `frame-${String(i).padStart(4, '0')}.exr`, 'sh2', 'f-sh2'))
      objects['rabbit-files'].add(`projects/${PID}/shots/sh2/1-frame-${String(i).padStart(4, '0')}.exr`)
    }
    for (let i = 0; i < 997; i++) tables.folders.push(folder(`x${i}`, 'custom', `ASSETS/x${String(i).padStart(4, '0')}`, 'r'))
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.moved.find(m => m.name === 'The-Cold-Lamp').files).toBe(1002)
    expect(tables.files.filter(f => f.storage_path.startsWith(`projects/${PID}/shots/sh2/`))).toHaveLength(0)
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().listFolders(PID)).toHaveLength(tables.folders.length)
    expect(tables.folders.length).toBeGreaterThan(1000)
    // The pages were asked for: two for the files, two for the folders.
    expect(client.log.some(e => e[0] === 'move' && e[3].endsWith('1-frame-1000.exr'))).toBe(true)
  })

  it('loadProject reads the shots and scenes whole too (the offer counts them): 1,001 shots are all in the bundle (round 2, item 8)', async () => {
    const { tables, objects } = fixture()
    for (let i = 0; i < 998; i++) tables.shots.push({ id: `s${String(i).padStart(4, '0')}`, name: `Shot ${i}`, scene_id: 'sc1', project_id: PID, sort_order: i })
    expect(tables.shots.length).toBe(1001)
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const bundle = await supabaseAdapter().loadProject(PID)
    expect(bundle.shots).toHaveLength(1001)
    expect(bundle.scenes).toHaveLength(2)
  })

  it('the SHOTS category is said to be gone only when the delete answers the row (an RLS-filtered delete does not), and never while the database still counts a folder under it', async () => {
    const { tables, objects } = fixture()
    let client = makeClient({ tables, objects, failDelete: (name) => (name === 'folders' ? 'filtered' : null) })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(res.removedShotsCategory).toBe(false)
    expect(tables.folders.some(f => f.path === 'SHOTS')).toBe(true)
    // A folder under SHOTS that the first list did not carry (a row another
    // tab inserted after the list was read): the count sees it, the delete
    // is not even tried.
    const fx2 = fixture()
    tables.folders.length = 0; tables.folders.push(...fx2.tables.folders)
    objects['rabbit-files'] = fx2.objects['rabbit-files']; objects['rabbit-thumbnails'] = fx2.objects['rabbit-thumbnails']
    tables.files.length = 0; tables.files.push(...fx2.tables.files)
    client = makeClient({
      tables, objects,
      onMove: (bucket, from) => { if (from.endsWith('1-plate.exr') && !tables.folders.some(f => f.id === 'f-sh8')) tables.folders.push(folder('f-sh8', 'entity', 'SHOTS/Late', 'c-shots', { entity_type: 'shot', shot_id: 'sh8' })) },
    })
    const res2 = await run(client)
    expect(res2.removedShotsCategory).toBe(false)
    expect(client.log.some(e => e[0] === 'delete' && e[1] === 'folders')).toBe(false)
    expect(tables.folders.some(f => f.path === 'SHOTS')).toBe(true)
  })

  it('one run per project at a time in this tab: a second call while one runs is refused, and the lock is released after', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const a = supabaseAdapter()
    const first = a.refileShotFolders(PID, project)
    await expect(a.refileShotFolders(PID, project)).rejects.toThrow('already running')
    await first
    const again = await a.refileShotFolders(PID, project)
    expect(again).toEqual({ moved: [], left: [], removedShotsCategory: false })
  })

  it('a body in the customer\'s own bucket, or on another computer, leaves its shot where it is with the reason', async () => {
    const { tables, objects } = fixture()
    tables.files.find(f => f.id === 'f3').storage_provider = 's3'
    tables.files.find(f => f.id === 'f1').storage_provider = 'local_server'
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.moved).toEqual([])
    expect(res.left.map(l => l.name).sort()).toEqual(['The-Cold-Lamp', 'The-Door'])
    expect(res.left.find(l => l.name === 'The-Cold-Lamp').reason).toContain('your own bucket')
    expect(res.left.find(l => l.name === 'The-Door').reason).toContain('desktop app')
    expect(client.log.some(e => e[0] === 'move')).toBe(false)
    expect(tables.folders.some(f => f.path === 'SHOTS')).toBe(true)
  })

  it('on the desktop, a private project\'s body moves through the local media provider, verified there', async () => {
    globalThis.__testLocalServer = true
    const { tables, objects } = fixture()
    tables.files.find(f => f.id === 'f3').storage_provider = 'local_server'
    localObjects.add(`projects/${PID}/shots/sh2/1-board.png`)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left).toEqual([])
    expect(localObjects.has(NEW.board)).toBe(true)
    expect(localObjects.has(`projects/${PID}/shots/sh2/1-board.png`)).toBe(false)
    expect(tables.files.find(f => f.id === 'f3').storage_path).toBe(NEW.board)
    expect(client.log.some(e => e[0] === 'move' && e[1] === 'rabbit-files' && e[2].endsWith('1-board.png'))).toBe(false)
  })
})

describe('ensureEntityFolder on this adapter (S4c)', () => {
  it('a NEW shot in a scene nests under the scene\'s row (made first if missing); a rename keeps the parent', async () => {
    const { tables, objects } = fixture()
    tables.folders = tables.folders.filter(f => f.id !== 'f-sc1')
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const a = supabaseAdapter()
    const row = await a.ensureEntityFolder(PID, project, 'shot', { id: 'sh9', name: 'Brand new', scene_id: 'sc1' })
    const scene = tables.folders.find(f => f.scene_id === 'sc1')
    expect(scene.path).toBe('SCENES/Lighthouse-Dawn')
    expect([row.path, row.parent_id]).toEqual(['SCENES/Lighthouse-Dawn/Brand-New', scene.id])
    // A shot under SHOTS renamed: stays under SHOTS.
    const kept = await a.ensureEntityFolder(PID, project, 'shot', { id: 'sh1', name: 'The door, wider', scene_id: 'sc1' })
    expect([kept.id, kept.path, kept.parent_id]).toEqual(['f-sh1', 'SHOTS/The-Door-Wider', 'c-shots'])
    // A nested shot renamed: stays nested.
    const again = await a.ensureEntityFolder(PID, project, 'shot', { id: 'sh9', name: 'Brand newer', scene_id: 'sc1' })
    expect([again.id, again.path, again.parent_id]).toEqual([row.id, 'SCENES/Lighthouse-Dawn/Brand-Newer', scene.id])
    // No scene: SHOTS, lazily made.
    const loose = await a.ensureEntityFolder(PID, project, 'shot', { id: 'sh3', name: 'Loose', scene_id: null })
    expect(loose.path).toBe('SHOTS/Loose')
    expect(tables.folders.filter(f => f.shot_id === 'sh9')).toHaveLength(1)
  })

  it('a renamed SCENE takes the rows under it along (its shot folders since S4c): each re-pathed, the scene first (review round 1, item 7)', async () => {
    const { tables, objects } = fixture()
    const door = tables.folders.find(f => f.id === 'f-sh1'); door.path = 'SCENES/Lighthouse-Dawn/The-Door'; door.parent_id = 'f-sc1'
    tables.folders.push(folder('plates', 'custom', 'SCENES/Lighthouse-Dawn/The-Door/plates', 'f-sh1'))
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const scene = await supabaseAdapter().ensureEntityFolder(PID, project, 'scene', { id: 'sc1', name: 'Lighthouse, dusk' })
    expect([scene.id, scene.path]).toEqual(['f-sc1', 'SCENES/Lighthouse-Dusk'])
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dusk/The-Door')
    expect(tables.folders.find(f => f.id === 'plates').path).toBe('SCENES/Lighthouse-Dusk/The-Door/plates')
    const updates = client.log.filter(e => e[0] === 'update' && e[1] === 'folders').map(e => e[2][0])
    expect(updates).toEqual(['f-sc1', 'f-sh1', 'plates'])
    // CONTROL: the other scene's rows, and SHOTS', are untouched.
    expect(tables.folders.find(f => f.id === 'f-sh2').path).toBe('SHOTS/The-Cold-Lamp')
  })

  it('the rows under a folder are walked by parent_id, not by a path prefix: a stale child of ANOTHER row is left alone, and a pass that stopped is finished on the next ensure, renaming or not (round 2, item 6)', async () => {
    const { tables, objects } = fixture()
    // The scene was renamed by an older build that re-pathed nothing: its
    // row says the new name, its shot row still the old.
    const sc = tables.folders.find(f => f.id === 'f-sc1'); sc.path = 'SCENES/Lighthouse-Dusk'; sc.slug = 'Lighthouse-Dusk'
    const door = tables.folders.find(f => f.id === 'f-sh1'); door.path = 'SCENES/Lighthouse-Dawn/The-Door'; door.parent_id = 'f-sc1'
    // A stale row of another scene that happens to carry the old prefix.
    tables.folders.push(folder('f-sc2', 'entity', 'SCENES/Cliff-Path', 'c-scenes', { entity_type: 'scene', scene_id: 'sc2' }))
    tables.folders.push(folder('stray', 'custom', 'SCENES/Lighthouse-Dawn/Not-Mine', 'f-sc2'))
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const scene = await supabaseAdapter().ensureEntityFolder(PID, project, 'scene', { id: 'sc1', name: 'Lighthouse, dusk' })
    expect(scene.path).toBe('SCENES/Lighthouse-Dusk')
    expect(tables.folders.find(f => f.id === 'f-sh1').path).toBe('SCENES/Lighthouse-Dusk/The-Door')
    expect(tables.folders.find(f => f.id === 'stray').path).toBe('SCENES/Lighthouse-Dawn/Not-Mine')
    expect(client.log.filter(e => e[0] === 'update' && e[1] === 'folders').map(e => e[2][0])).toEqual(['f-sh1'])
  })
})

describe('uploadFile keys a shot\'s object (S4c)', () => {
  const txt = () => new File(['hello'], 'notes.txt', { type: 'text/plain' })
  it('inside its scene\'s prefix once the shot\'s folder is nested (or has no row); under the old prefix while the folder still sits under SHOTS', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects })
    globalThis.__testSupabase = client
    const a = supabaseAdapter()
    // The folder still under SHOTS: the old prefix keeps objects and folder together.
    const legacy = await a.uploadFile(PID, { shotId: 'sh1' }, txt())
    expect(legacy.storage_path).toMatch(new RegExp(`^projects/${PID}/shots/sh1/\\d+-notes\\.txt$`))
    expect(legacy.folder_id).toBe('f-sh1')
    // Re-filed: nested by ids.
    const door = tables.folders.find(f => f.id === 'f-sh1'); door.path = 'SCENES/Lighthouse-Dawn/The-Door'; door.parent_id = 'f-sc1'
    const nested = await a.uploadFile(PID, { shotId: 'sh1' }, txt())
    expect(nested.storage_path).toMatch(new RegExp(`^projects/${PID}/scenes/sc1/sh1/\\d+-notes\\.txt$`))
    expect(nested.shot_id).toBe('sh1')
    expect(nested.scene_id).toBeNull()
    // No folder row at all: nested too.
    tables.folders = tables.folders.filter(f => f.id !== 'f-sh2')
    const noRow = await a.uploadFile(PID, { shotId: 'sh2' }, txt())
    expect(noRow.storage_path).toMatch(new RegExp(`^projects/${PID}/scenes/sc1/sh2/`))
    expect(noRow.folder_id).toBeNull()
    // A shot with no scene: the old prefix.
    const loose = await a.uploadFile(PID, { shotId: 'sh3' }, txt())
    expect(loose.storage_path).toMatch(new RegExp(`^projects/${PID}/shots/sh3/`))
    // CONTROL: a scene's own file is untouched by any of this.
    const scene = await a.uploadFile(PID, { sceneId: 'sc1' }, txt())
    expect(scene.storage_path).toMatch(new RegExp(`^projects/${PID}/scenes/sc1/\\d+-notes\\.txt$`))
  })
})
