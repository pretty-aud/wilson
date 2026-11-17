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
        return { data: q.single ? list[0] : list, error: null }
      }
      if (q.write?.kind === 'update') {
        const hit = rows.filter((r) => matches(r, q.filters))
        for (const r of hit) Object.assign(r, q.write.patch)
        log.push({ table, kind: 'update', rows: hit.length })
        return { data: q.single ? hit[0] ?? null : hit, error: null }
      }
      let out = rows.filter((r) => matches(r, q.filters))
      if (q.range) out = out.slice(q.range[0], q.range[1] + 1)
      out = out.slice(0, q.limit ?? MAX_ROWS)
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

const { supabaseAdapter, resetSupabaseAdapter, resetShotListSchemaState } = await import('./supabaseAdapter')

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

