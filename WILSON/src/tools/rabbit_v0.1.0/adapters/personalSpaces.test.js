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
