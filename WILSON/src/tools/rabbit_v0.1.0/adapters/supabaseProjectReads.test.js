// =============================================================================
// supabaseProjectReads.test.js — F5 item 1 (rabbit B2, C2's comments, C4):
// what the cloud adapter reads, counted.
//
// The measurement and the pin are the same test, over an in-memory PostgREST
// that serves at most 1,000 rows a request (as the real one does), applies
// the filters it is given and records every request it answers. Before F5:
// loadProject paged assets, tasks, scenes and shots but not phases, levels,
// experiences, milestones or folders, and no list* method paged at all, so a
// project past 1,000 rows of a kind lost some in one view or the other; the
// comments read had no filter (every comment the person could see, in every
// project); a New shot read the whole folder tree twice and the shot's scene
// row once; every uploaded file looked up its folder and the project's
// privacy again.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const MAX_ROWS = 1000

function makeDb(tables) {
  const log = []
  // The next n selects of a table answer an error (a dropped connection).
  const failures = {}
  let seq = 0
  const matches = (row, filters) => filters.every(([op, col, val]) => {
    if (col.includes('.')) return true // an embedded filter: not modelled
    if (op === 'eq') return String(row[col]) === String(val)
    if (op === 'in') return val.map(String).includes(String(row[col]))
    if (op === 'is') return (row[col] ?? null) === val
    return true
  })
  function builder(table) {
    const q = { table, filters: [], range: null, limit: null, write: null, single: null }
    const run = () => {
      const rows = tables[table] || (tables[table] = [])
      if (q.write?.kind === 'insert') {
        const list = (Array.isArray(q.write.row) ? q.write.row : [q.write.row]).map((r) => ({ id: `new-${++seq}`, ...r }))
        if (table === 'folders' && list.some((r) => rows.some((x) => x.project_id === r.project_id && x.path === r.path))) {
          log.push({ table, kind: 'insert', rows: 0 })
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        rows.push(...list)
        log.push({ table, kind: 'insert', rows: list.length })
        const answer = list.map((r) => ({ ...r }))
        return { data: q.single ? answer[0] : answer, error: null }
      }
      if (q.write?.kind === 'update') {
        const hit = rows.filter((r) => matches(r, q.filters))
        for (const r of hit) Object.assign(r, q.write.patch)
        log.push({ table, kind: 'update', rows: hit.length })
        const answer = hit.map((r) => ({ ...r }))
        return { data: q.single ? answer[0] ?? null : answer, error: null }
      }
      if (failures[table] > 0) {
        failures[table] -= 1
        log.push({ table, kind: 'select', rows: 0, ids: [], filters: q.filters, failed: true })
        return { data: null, error: { code: '08006', message: 'connection lost' } }
      }
      let out = rows.filter((r) => matches(r, q.filters))
      if (q.range) out = out.slice(q.range[0], q.range[1] + 1)
      // Copies, as a real server's answer is: no caller holds the stored rows.
      out = out.slice(0, q.limit ?? MAX_ROWS).map((r) => ({ ...r }))
      log.push({ table, kind: 'select', rows: out.length, ids: out.map((r) => r.id), filters: q.filters })
      if (q.single === 'single') return out[0] ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      if (q.single === 'maybe') return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }
    const b = {
      select: () => b,
      eq: (col, val) => { q.filters.push(['eq', col, val]); return b },
      in: (col, val) => { q.filters.push(['in', col, val]); return b },
      is: (col, val) => { q.filters.push(['is', col, val]); return b },
      neq: () => b, not: () => b, or: () => b, gte: () => b, lte: () => b, gt: () => b, lt: () => b, filter: () => b, match: () => b,
      order: () => b,
      range: (a, z) => { q.range = [a, z]; return b },
      limit: (n) => { q.limit = n; return b },
      single: () => { q.single = 'single'; return b },
      maybeSingle: () => { q.single = 'maybe'; return b },
      insert: (row) => { q.write = { kind: 'insert', row }; return b },
      upsert: (row) => { q.write = { kind: 'insert', row }; return b },
      update: (patch) => { q.write = { kind: 'update', patch }; return b },
      delete: () => { q.write = { kind: 'delete' }; return b },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    }
    return b
  }
  return {
    log,
    failures,
    client: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'x.e30.x' } } }) },
      from: (table) => builder(table),
      rpc: async () => ({ data: [], error: null }),
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }) }) },
    },
  }
}

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))
// The upload path's storage choice: Petal's own (null), with no read of its own.
vi.mock('../../../cloud/workspaceStorage', () => ({ getWorkspaceStorageCached: async () => null }))

const { supabaseAdapter, resetSupabaseAdapter, resetShotListSchemaState } = await import('./supabaseAdapter')
const { registerStorageProvider, FILE_PROVIDERS } = await import('../storage')

let db
beforeEach(() => { resetSupabaseAdapter(); resetShotListSchemaState() })
afterEach(() => {
  resetSupabaseAdapter()
  resetShotListSchemaState()
  delete globalThis.__testSupabase
  vi.restoreAllMocks()
})

function use(tables) {
  db = makeDb(tables)
  globalThis.__testSupabase = db.client
  return supabaseAdapter()
}

const N = 1001
const many = (kind, extra = (i) => ({})) => Array.from({ length: N }, (_, i) => ({
  id: `${kind}-${String(i).padStart(5, '0')}`, project_id: 'p1', sort_order: i, ...extra(i),
}))

describe('every collection is read whole, by loadProject and by its list method', () => {
  const KINDS = [
    ['phases', 'phases', 'listPhases'],
    ['assets', 'assets', 'listAssets'],
    ['tasks', 'tasks', 'listTasks'],
    ['scenes', 'scenes', 'listScenes'],
    ['shots', 'shots', 'listShots'],
    ['levels', 'levels', 'listLevels'],
    ['experiences', 'experiences', 'listExperiences'],
    ['milestones', 'milestones', 'listMilestones'],
    ['folders', 'folders', 'listFolders'],
  ]
  function project() {
    const tables = { projects: [{ id: 'p1', title: 'Big', workspace_id: 'ws-1' }] }
    for (const [table] of KINDS) {
      tables[table] = many(table, (i) => (table === 'folders' ? { path: `F/${String(i).padStart(5, '0')}`, kind: 'custom', slug: `f${i}` } : table === 'milestones' ? { date: '2026-01-01' } : {}))
    }
    return tables
  }

  it('loadProject returns all 1,001 rows of each', async () => {
    const adapter = use(project())
    const bundle = await adapter.loadProject('p1')
    const short = KINDS.filter(([, key]) => (bundle[key] || []).length !== N).map(([, key]) => `${key}: ${(bundle[key] || []).length}`)
    expect(short).toEqual([])
  })

  it('each list method returns all 1,001 rows', async () => {
    const adapter = use(project())
    const short = []
    for (const [, , method] of KINDS) {
      const rows = await adapter[method]('p1')
      if ((rows || []).length !== N) short.push(`${method}: ${(rows || []).length}`)
    }
    expect(short).toEqual([])
  })
})

describe('a project load reads that project\'s comments only', () => {
  it('serves no comment on another project\'s rows', async () => {
    const adapter = use({
      projects: [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }],
      tasks: [{ id: 't1', project_id: 'p1' }, { id: 't2', project_id: 'p2' }],
      phases: [{ id: 'ph1', project_id: 'p1' }],
      assets: [{ id: 'a1', project_id: 'p1' }],
      comments: [
        { id: 'c-task', entity_type: 'task', entity_id: 't1', body: 'mine' },
        { id: 'c-project', entity_type: 'project', entity_id: 'p1', body: 'mine' },
        { id: 'c-other', entity_type: 'task', entity_id: 't2', body: 'not mine' },
        { id: 'c-other-project', entity_type: 'project', entity_id: 'p2', body: 'not mine' },
      ],
    })
    const bundle = await adapter.loadProject('p1')
    const served = db.log.filter((r) => r.table === 'comments' && r.kind === 'select').flatMap((r) => r.ids)
    expect(served.filter((id) => id.startsWith('c-other'))).toEqual([])
    expect((bundle.comments || []).map((c) => c.id).sort()).toEqual(['c-project', 'c-task'])
  })
})

describe('a New shot and a drop of files', () => {
  const project = { id: 'p1', title: 'Film', slug: 'film' }
  function tree() {
    return {
      projects: [{ id: 'p1', title: 'Film', is_private: false }],
      scenes: [{ id: 's1', project_id: 'p1', name: 'Opening' }],
      shots: [{ id: 'sh1', project_id: 'p1', scene_id: 's1', name: 'Wide' }],
      folders: [],
      files: [],
    }
  }
  const folderReads = () => db.log.filter((r) => r.table === 'folders' && r.kind === 'select').length

  it("a New shot reads the folder tree once, its scene's ensure sharing it, and its scene's row once", async () => {
    const adapter = use(tree())
    await adapter.ensureEntityFolder('p1', project, 'scene', { id: 's1', name: 'Opening' })
    db.log.length = 0
    await adapter.ensureEntityFolder('p1', project, 'shot', { id: 'sh2', project_id: 'p1', scene_id: 's1', name: 'Close' })
    expect({ folderReads: folderReads(), sceneReads: db.log.filter((r) => r.table === 'scenes').length }).toEqual({ folderReads: 1, sceneReads: 1 })
  })

  it("ten files dropped on a shot read its folder and its scene once, and the project's privacy for every file", async () => {
    for (const name of Object.values(FILE_PROVIDERS)) {
      registerStorageProvider(name, { put: async () => {}, get: async () => new Blob(['x']), del: async () => {}, exists: async () => true, describe: async () => ({ ok: true }), getUrl: async () => null })
    }
    const tables = tree()
    // The shot's folder, under its scene (not under SHOTS/: the scene is asked).
    tables.folders = [{ id: 'f-shot', project_id: 'p1', shot_id: 'sh1', path: 'SCENES/opening/wide', kind: 'entity' }]
    const adapter = use(tables)
    const batch = {}
    db.log.length = 0
    for (let i = 0; i < 10; i += 1) {
      await adapter.uploadFile('p1', { shotId: 'sh1' }, { name: `take-${i}.txt`, type: 'text/plain', size: 3 }, { batch })
    }
    const count = (table, col) => db.log.filter((r) => r.table === table && r.kind === 'select' && r.filters.some(([, c]) => c === col)).length
    // Privacy for every file (review round 1, security): its probe answers
    // "not private" on an error, so a kept answer could send the rest of a
    // private project's drop to the cloud.
    expect({ folder: count('folders', 'shot_id'), scene: count('shots', 'id'), privacy: count('projects', 'id') }).toEqual({ folder: 1, scene: 1, privacy: 10 })
    expect(db.log.filter((r) => r.table === 'files' && r.kind === 'insert').length).toBe(10)
  })
})

describe('review round 2: whether a project is private fails CLOSED', () => {
  it("a privacy probe that fails refuses the file, and nothing of a private project's goes to the cloud", async () => {
    const puts = []
    for (const name of Object.values(FILE_PROVIDERS)) {
      registerStorageProvider(name, { put: async (path) => { puts.push({ name, path }) }, get: async () => new Blob(['x']), del: async () => {}, exists: async () => true, describe: async () => ({ ok: true }), getUrl: async () => null })
    }
    const adapter = use({ projects: [{ id: 'p1', title: 'Secret', is_private: true }], shots: [], folders: [], files: [] })
    db.failures.projects = 1 // the is_private probe's read
    await expect(adapter.uploadFile('p1', { assetId: 'a1' }, { name: 'still.txt', type: 'text/plain', size: 3 }, {})).rejects.toThrow(/private/)
    expect(puts).toEqual([])
  })
})
