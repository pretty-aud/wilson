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

/** Tables and two buckets in memory; `log` records every call in order. */
function makeClient({ tables, objects, failMove = () => null, failUpdate = () => null, dropLanding = () => false } = {}) {
  const log = []
  let seq = 0
  const table = (name) => {
    const state = { op: 'select', filters: [], payload: null, single: false, maybe: false }
    const b = {
      select() { return b },
      order() { return b },
      limit() { return b },
      eq(col, v) { state.filters.push(r => String(r[col]) === String(v)); return b },
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
        let result
        if (state.op === 'select') {
          const hits = rows.filter(match).map(r => ({ ...r }))
          if (state.single) result = hits[0] ? { data: hits[0], error: null } : { data: null, error: { message: 'no rows' } }
          else if (state.maybe) result = { data: hits[0] || null, error: null }
          else result = { data: hits, error: null }
        } else if (state.op === 'insert') {
          const row = { id: `new-${++seq}`, ...state.payload }
          rows.push(row)
          log.push(['insert', name, row.path || row.name || row.id])
          result = { data: { ...row }, error: null }
        } else if (state.op === 'update') {
          const hits = rows.filter(match)
          const refused = failUpdate(name, state.payload, hits)
          if (refused) { log.push(['update-refused', name, hits.map(h => h.id)]); result = { data: null, error: { message: refused } } }
          else {
            for (const r of hits) Object.assign(r, state.payload)
            log.push(['update', name, hits.map(h => h.id), { ...state.payload }])
            result = { data: state.single ? (hits[0] ? { ...hits[0] } : null) : hits.map(h => ({ ...h })), error: state.single && !hits[0] ? { message: 'no rows' } : null }
          }
        } else if (state.op === 'delete') {
          const hits = rows.filter(match)
          for (const h of hits) rows.splice(rows.indexOf(h), 1)
          log.push(['delete', name, hits.map(h => h.id)])
          result = { data: null, error: null }
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
    // THE ORDER, for the door's plate: move body → see it → move thumb → see it → update the row → update the folder.
    const log = client.log
    const moveBody = indexOf(log, e => e[0] === 'move' && e[1] === 'rabbit-files' && e[3] === NEW.plate)
    const seeBody = indexOf(log, e => e[0] === 'list' && e[1] === 'rabbit-files' && e[2] === `projects/${PID}/scenes/sc1/sh1` && e[3] === '1-plate.exr' && log.indexOf(e) > moveBody)
    const moveThumb = indexOf(log, e => e[0] === 'move' && e[1] === 'rabbit-thumbnails')
    const seeThumb = indexOf(log, e => e[0] === 'list' && e[1] === 'rabbit-thumbnails' && e[3] === '1-plate.exr.jpg' && log.indexOf(e) > moveThumb)
    const rowUpdate = indexOf(log, e => e[0] === 'update' && e[1] === 'files' && e[2].includes('f1'))
    const folderUpdate = indexOf(log, e => e[0] === 'update' && e[1] === 'folders' && e[2].includes('f-sh1'))
    const categoryDelete = indexOf(log, e => e[0] === 'delete' && e[1] === 'folders' && e[2].includes('c-shots'))
    for (const i of [moveBody, seeBody, moveThumb, seeThumb, rowUpdate, folderUpdate, categoryDelete]) expect(i).toBeGreaterThanOrEqual(0)
    expect(moveBody).toBeLessThan(seeBody)
    expect(seeBody).toBeLessThan(moveThumb)
    expect(moveThumb).toBeLessThan(seeThumb)
    expect(seeThumb).toBeLessThan(rowUpdate)
    expect(rowUpdate).toBeLessThan(folderUpdate)
    expect(folderUpdate).toBeLessThan(categoryDelete)
    expect(log.filter(e => e[0] === 'update' && e[1] === 'files').map(e => e[2][0]).sort()).toEqual(['f1', 'f3'])
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

  it('a thumbnail that cannot follow its body puts the body back', async () => {
    const { tables, objects } = fixture()
    const client = makeClient({ tables, objects, failMove: (bucket) => (bucket === 'rabbit-thumbnails' ? 'thumbnails bucket down' : null) })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Door'])
    expect(res.left[0].reason).toContain('thumbnails bucket down')
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh1/1-plate.exr`)).toBe(true)
    expect(tables.files.find(f => f.id === 'f1').storage_path).toBe(`projects/${PID}/shots/sh1/1-plate.exr`)
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

  it('an object at BOTH keys is left alone (nothing is ever overwritten or deleted), and its shot with it', async () => {
    const { tables, objects } = fixture()
    objects['rabbit-files'].add(NEW.board)
    const client = makeClient({ tables, objects })
    const res = await run(client)
    expect(res.left.map(l => l.name)).toEqual(['The-Cold-Lamp'])
    expect(res.left[0].reason).toContain('exists at both')
    expect(objects['rabbit-files'].has(NEW.board)).toBe(true)
    expect(objects['rabbit-files'].has(`projects/${PID}/shots/sh2/1-board.png`)).toBe(true)
    expect(client.log.some(e => e[0] === 'move' && e[2].endsWith('1-board.png'))).toBe(false)
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
