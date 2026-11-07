// =============================================================================
// personalSpaces.test.js — MO1 (migration 0110, MOTH_DESIGN §2.2 PS-2, PS-6, PS-8,
// AU-1, PSA-11): the cloud adapter's half of personal spaces. listProjects keeps
// them out only where the column exists (a database without 0110 lists as
// before); the RPCs send the names the functions have; a database without the
// functions gets a sentence, and a failure inside one reaches the caller.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

let mod
let adapter

/** A client on a database with (or without) 0110, recording every read and RPC. */
function makeClient({ has0110 = true, probeError = null, rpcError = null, rows = [], rpcData = 'space-id' } = {}) {
  const reads = []
  const rpcs = []
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'u1@test.local', user_metadata: {} } } } }) },
    realtime: { setAuth: async () => {} },
    rpc: async (fn, args) => {
      rpcs.push({ fn, args })
      if (fn === 'project_topic_matches') return { data: false, error: null }
      if (rpcError) return { data: null, error: rpcError }
      return { data: rpcData, error: null }
    },
    from(table) {
      const read = { table, cols: null, filters: [] }
      reads.push(read)
      const b = {
        select: (c) => { read.cols = c; return b },
        limit: () => b,
        order: () => b,
        is: (col, val) => { read.filters.push(['is', col, val]); return b },
        not: (col, op, val) => { read.filters.push(['not', col, op, val]); return b },
        then: (resolve) => {
          if (read.cols === 'personal_owner_id') {
            if (probeError) return resolve({ error: probeError })
            if (!has0110) return resolve({ error: { code: '42703', message: 'column projects.personal_owner_id does not exist' } })
          }
          return resolve({ data: rows, error: null })
        },
      }
      return b
    },
  }
  return { client, reads, rpcs }
}

const use = (fake) => { mod.resetSupabaseAdapter(); globalThis.__testSupabase = fake.client; return fake }
const listReads = (fake) => fake.reads.filter(r => /^id, title, status/.test(r.cols || ''))

beforeEach(async () => {
  vi.resetModules()
  mod = await import('./supabaseAdapter')
  mod.resetSupabaseAdapter()
  adapter = mod.supabaseAdapter()
})
afterEach(() => { delete globalThis.__testSupabase })

describe('listProjects', () => {
  it('keeps personal spaces out where the column exists', async () => {
    const fake = use(makeClient())
    await adapter.listProjects()
    expect(listReads(fake)[0].filters).toEqual([['is', 'personal_owner_id', null]])
  })
  it('🚨 a window open across 0110\'s apply asks again on an auth event, so a space does not list as a project', async () => {
    const before = use(makeClient({ has0110: false }))
    await adapter.listProjects()
    expect(listReads(before)[0].filters).toEqual([])
    const after = makeClient({ has0110: true })
    globalThis.__testSupabase = after.client
    mod.resetSupabaseAdapter()
    await adapter.listProjects()
    expect(listReads(after)[0].filters).toEqual([['is', 'personal_owner_id', null]])
  })
  it('CONTROL: a database without 0110 lists as before, no filter', async () => {
    const fake = use(makeClient({ has0110: false }))
    await adapter.listProjects()
    expect(listReads(fake)).toHaveLength(1)
    expect(listReads(fake)[0].filters).toEqual([])
  })
  it('"not now" fails closed: an admin\'s list is not read as if there were no spaces to keep out', async () => {
    const fake = use(makeClient({ probeError: { code: '503', message: 'network' } }))
    await expect(adapter.listProjects()).rejects.toThrow('the project list could not be read just now')
    expect(listReads(fake)).toEqual([])
  })
})

// MO1 (0111, MOTH_DESIGN §2.2 MR-1): Moth's three reads. The names are pinned
// because PGRST202 is also PostgREST's answer to a parameter-NAME mismatch.
describe('Moth\'s reads', () => {
  const ABSENT = 'this workspace\'s database does not have M.O.T.H. yet'
  /** rpc() as PostgREST's builder: range() narrows, awaiting answers. */
  function rpcClient(answer) {
    const calls = []
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'u1@test.local', user_metadata: {} } } } }) },
      realtime: { setAuth: async () => {} },
      rpc(fn, args) {
        const call = { fn, args, range: null }
        calls.push(call)
        const b = {
          range(from, to) { call.range = [from, to]; return b },
          then: (resolve) => resolve(answer(call)),
        }
        return b
      },
    }
    return { client, calls }
  }
  const rows = (n, at = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${at + i}` }))

  it('listMothIslands calls moth_islands with no arguments and follows the pages', async () => {
    const { client, calls } = rpcClient(({ range }) => ({ data: range[0] === 0 ? rows(1000) : rows(2, 1000), error: null }))
    use({ client })
    expect(await adapter.listMothIslands()).toHaveLength(1002)
    expect(calls.map(c => [c.fn, c.args, c.range])).toEqual([
      ['moth_islands', undefined, [0, 999]],
      ['moth_islands', undefined, [1000, 1999]],
    ])
  })

  it('listMothFolders names p_project and follows the pages', async () => {
    const { client, calls } = rpcClient(() => ({ data: rows(3), error: null }))
    use({ client })
    expect(await adapter.listMothFolders('p1')).toHaveLength(3)
    expect(calls).toEqual([{ fn: 'moth_project_folders', args: { p_project: 'p1' }, range: [0, 999] }])
  })

  it('listMothFiles is one page, named p_project, p_after and p_limit', async () => {
    const { client, calls } = rpcClient(() => ({ data: rows(2), error: null }))
    use({ client })
    expect(await adapter.listMothFiles('p1', 'r9', 50)).toHaveLength(2)
    expect(await adapter.listMothFiles('p1')).toHaveLength(2)
    expect(calls.map(c => c.args)).toEqual([
      { p_project: 'p1', p_after: 'r9', p_limit: 50 },
      { p_project: 'p1', p_after: null, p_limit: 500 },
    ])
    expect(calls.every(c => c.range === null)).toBe(true)
  })

  it.each([
    ['listMothIslands', 'moth_islands'],
    ['listMothFolders', 'moth_project_folders'],
    ['listMothFiles', 'moth_project_files'],
  ])('%s on a database without it: the sentence, for PGRST202 and a 42883 naming it', async (method, fn) => {
    use({ client: rpcClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })).client })
    await expect(adapter[method]('p')).rejects.toThrow(ABSENT)
    use({ client: rpcClient(() => ({ data: null, error: { code: '42883', message: `function public.${fn}() does not exist` } })).client })
    await expect(adapter[method]('p')).rejects.toThrow(ABSENT)
  })

  it('CONTROL: a failure inside one is the real failure', async () => {
    use({ client: rpcClient(() => ({ data: null, error: { code: '42883', message: 'function public.some_helper() does not exist' } })).client })
    await expect(adapter.listMothFiles('p')).rejects.toThrow('some_helper')
  })

  it('an empty answer is an empty list, not an error', async () => {
    use({ client: rpcClient(() => ({ data: [], error: null })).client })
    expect(await adapter.listMothFiles('hidden')).toEqual([])
    expect(await adapter.listMothFolders('hidden')).toEqual([])
    expect(await adapter.listMothIslands()).toEqual([])
  })
})

// MO1 (0111, review round 1): the desktop's three, over a stubbed Local Server.
describe('Moth\'s reads on the signed-out desktop', () => {
  const ROUTES = {
    '/api/rabbit/projects': { status: 200, body: [{ id: 'p1', title: 'One', updated_at: 't1' }, { id: 'p2', title: 'Gone', deleted_at: 't0' }] },
    '/api/rabbit/personal-space': { status: 200, body: { project: { id: 'space', title: 'Personal space', updated_at: 't2' } } },
    '/api/rabbit/projects/p1': {
      status: 200,
      body: {
        folders: [
          { id: 'root', parent_id: null, kind: 'root', slug: 'one', path: '' },
          { id: 'inv', parent_id: 'root', kind: 'category', slug: 'INVOICES', path: 'INVOICES' },
          { id: 'inv-x', parent_id: 'inv', kind: 'custom', slug: 'x', path: 'INVOICES/x' },
          { id: 'scenes', parent_id: 'root', kind: 'category', slug: 'SCENES', path: 'SCENES' },
        ],
        files: [{ id: 'f2', name: 'b.txt' }, { id: 'f1', name: 'a.txt' }, { id: 'f0', name: 'binned.txt', deleted_at: 't0' }],
        managedFiles: [
          { id: 'm1', file_name: 'shot.mov', size_bytes: 7, asset_id: 'a1', tags: [] },
          { id: 'm0', file_name: 'gone.mov', deleted_at: 't0' },
        ],
      },
    },
    '/api/rabbit/projects/missing': { status: 404, body: { error: 'project not found' } },
    '/api/rabbit/projects/broken': { status: 500, body: { error: 'disk' } },
  }
  let routes
  let local
  beforeEach(async () => {
    routes = { ...ROUTES }
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const hit = routes[String(url)]
      if (!hit) throw new Error(`unrouted ${url}`)
      return { ok: hit.status < 400, status: hit.status, headers: { get: () => 'application/json' }, json: async () => hit.body }
    }))
    const { localServerAdapter } = await import('./localServerAdapter')
    local = localServerAdapter()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('lists the personal space first, as its own, and no binned project', async () => {
    const islands = await local.listMothIslands()
    expect(islands.map(i => [i.id, i.is_personal, i.is_mine, i.can_write])).toEqual([['space', true, true, true], ['p1', false, false, true]])
  })
  it('an unreadable personal bundle costs the space, not the projects', async () => {
    routes['/api/rabbit/personal-space'] = { status: 409, body: { error: 'unreadable', code: 'unreadable' } }
    expect((await local.listMothIslands()).map(i => i.id)).toEqual(['p1'])
  })
  it('CONTROL: any other failure of the personal read is a failure', async () => {
    routes['/api/rabbit/personal-space'] = { status: 500, body: { error: 'disk' } }
    await expect(local.listMothIslands()).rejects.toThrow('disk')
  })
  it('leaves money folders and those under them out of the tree', async () => {
    expect((await local.listMothFolders('p1')).map(f => f.id)).toEqual(['root', 'scenes'])
  })
  it('lists files and managed files by id, live only, the managed ones marked', async () => {
    const rows = await local.listMothFiles('p1')
    expect(rows.map(r => r.id)).toEqual(['f1', 'f2', 'm1'])
    expect(rows[2]).toMatchObject({ name: 'shot.mov', managed: true, folder_id: null, storage_path: null, project_id: 'p1' })
  })
  it('keeps the cloud\'s keyset and clamp', async () => {
    expect((await local.listMothFiles('p1', 'f1')).map(r => r.id)).toEqual(['f2', 'm1'])
    expect((await local.listMothFiles('p1', null, 1)).map(r => r.id)).toEqual(['f1'])
    expect((await local.listMothFiles('p1', null, -3)).map(r => r.id)).toEqual(['f1'])
  })
  it('a project this desktop no longer holds is an empty answer, not an error', async () => {
    expect(await local.listMothFiles('missing')).toEqual([])
    expect(await local.listMothFolders('missing')).toEqual([])
  })
  it('CONTROL: any other failure of the bundle read is a failure', async () => {
    await expect(local.listMothFiles('broken')).rejects.toThrow('disk')
    await expect(local.listMothFolders('broken')).rejects.toThrow('disk')
  })
})

describe('listPersonalSpaces', () => {
  it('reads the owner column under RLS, for spaces only', async () => {
    const row = { id: 'ps1', title: 'Personal space', personal_owner_id: 'u1', folder_slug: 'Personal_u1', updated_at: 'x' }
    const fake = use(makeClient({ rows: [row] }))
    expect(await adapter.listPersonalSpaces()).toEqual([row])
    const read = fake.reads.find(r => r.cols === 'id, title, personal_owner_id, folder_slug, updated_at')
    expect(read.filters).toEqual([['not', 'personal_owner_id', 'is', null]])
  })
  it('CONTROL: a database without 0110 has none, and is not asked', async () => {
    const fake = use(makeClient({ has0110: false }))
    expect(await adapter.listPersonalSpaces()).toEqual([])
    expect(fake.reads.map(r => r.cols)).toEqual(['personal_owner_id'])
  })
})

describe('the two RPCs (PSA-11)', () => {
  const ABSENT = "this workspace's database does not have personal spaces yet"

  it('ensurePersonalSpace answers the server\'s id', async () => {
    const fake = use(makeClient({ rpcData: 'space-7' }))
    expect(await adapter.ensurePersonalSpace()).toBe('space-7')
    expect(fake.rpcs).toEqual([{ fn: 'ensure_personal_space', args: undefined }])
  })
  it('recordPersonalSpaceOpened names p_project', async () => {
    const fake = use(makeClient({ rpcData: null }))
    await adapter.recordPersonalSpaceOpened('space-7')
    expect(fake.rpcs).toEqual([{ fn: 'record_personal_space_opened', args: { p_project: 'space-7' } }])
  })
  it.each([
    ['ensurePersonalSpace', 'ensure_personal_space'],
    ['recordPersonalSpaceOpened', 'record_personal_space_opened'],
  ])('%s on a database without it: the sentence, for PGRST202 and a 42883 naming it', async (method, fn) => {
    use(makeClient({ rpcError: { code: 'PGRST202', message: 'Could not find the function' } }))
    await expect(adapter[method]('p')).rejects.toThrow(ABSENT)
    use(makeClient({ rpcError: { code: '42883', message: `function public.${fn}() does not exist` } }))
    await expect(adapter[method]('p')).rejects.toThrow(ABSENT)
  })
  it.each([
    ['ensurePersonalSpace'],
    ['recordPersonalSpaceOpened'],
  ])('CONTROL: %s, a 42883 raised inside its body, or a refusal, is the real failure', async (method) => {
    use(makeClient({ rpcError: { code: '42883', message: 'function public.some_helper() does not exist' } }))
    await expect(adapter[method]('p')).rejects.toThrow('some_helper')
    use(makeClient({ rpcError: { code: '42501', message: 'Only an active member can have a personal space.' } }))
    await expect(adapter[method]('p')).rejects.toThrow('Only an active member')
  })
})

describe('supportsPersonalSpaces', () => {
  it('true only where the column is known to be there', async () => {
    use(makeClient())
    expect(await adapter.supportsPersonalSpaces()).toBe(true)
  })
  it('CONTROL: without 0110, or not now, false', async () => {
    use(makeClient({ has0110: false }))
    expect(await adapter.supportsPersonalSpaces()).toBe(false)
    vi.resetModules()
    const again = await import('./supabaseAdapter')
    again.resetSupabaseAdapter()
    use(makeClient({ probeError: { code: '503', message: 'network' } }))
    expect(await again.supabaseAdapter().supportsPersonalSpaces()).toBe(false)
  })
})

describe('MO1 (MOTH §1.10): what the signed-out desktop tells the Moth page', () => {
  it('names a project\'s expense files, its money folders and its folder rows', async () => {
    const { localServerAdapter } = await import('./localServerAdapter')
    const local = localServerAdapter()
    const bundle = {
      project: { folder_slug: 'salt' },
      expenses: [{ file_ids: ['r1', 'r2'] }, { file_ids: null }, {}],
      folders: [{ id: 'f' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200, headers: { 'content-type': 'application/json' } })))
    try {
      bundle.files = [{ id: 'a', storage_path: 'a.mov' }, { id: 'i', storage_path: 'INVOICES/i.pdf' }, { id: 'l', storage_path: 'legal/l.pdf' }, { id: 'd', storage_path: 'rushes/LEGAL/d.mov' }]
      expect((await local.listMothFiles('p1')).map((f) => f.id)).toEqual(['a', 'd'])
      expect(await local.mothHiddenFacts('p1')).toEqual({
        expenseFileIds: ['r1', 'r2'],
        localMoneyDirs: ['salt_RECEIPTS&INVOICES', 'salt_CREWINVOICES', 'salt_TALENTINVOICES'],
        folders: [{ id: 'f' }],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
