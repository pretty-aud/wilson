// mothS3Cloud.test.js — MO3 (the session review): the cloud adapter's Session 3 reads come back whole, and a change
// the database made to no row says why in words.
//
// PostgREST answers at most max_rows rows a call (1,000, supabase/config.toml) and says nothing of the rest, so
// Moth's lists of tags, types, uses, nominations and workspace notes are read a page at a time, in an order whose
// last key is the id, up to a bound; a list cut at its bound says so (`truncated` on the array). A rename, a retire,
// a type's change, a delete or a link's label that matched no row (a policy hid it, or it is gone) is refused in
// words with 42501, never a quiet null the panel would show as done. And the notes' tier probe is not remembered as
// "no tiers" for the session, nor taken from a message that merely holds the word, and a person's own list always
// asks for their own notes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

const PAGE = 1000
const ME = 'u-mara'

// A client that answers like PostgREST: a range is honoured, but never more than max_rows an answer; with no range,
// the first max_rows only. An update or delete answers `writes[table]` (the rows it changed).
function makeClient({ rows = {}, rpcRows = {}, writes = {}, probe = () => ({ data: [], error: null }) } = {}) {
  const calls = []
  const builder = (name, source) => {
    const q = { name, range: null, orders: [], filters: [], op: 'select', cols: null }
    const b = {
      select: (cols) => { if (q.op === 'select') q.cols = cols; return b },
      update: (patch) => { q.op = 'update'; q.patch = patch; return b },
      delete: () => { q.op = 'delete'; return b },
      eq: (c, v) => { q.filters.push(['eq', c, v]); return b },
      neq: (c, v) => { q.filters.push(['neq', c, v]); return b },
      is: (c, v) => { q.filters.push(['is', c, v]); return b },
      limit: (n) => { q.limit = n; return b },
      order: (col) => { q.orders.push(col); return b },
      range: (from, to) => { q.range = [from, to]; return b },
      then: (resolve, reject) => {
        calls.push(q)
        let answer
        if (name === 'notes' && q.op === 'select' && q.cols === 'tier') answer = probe()
        else if (q.op !== 'select') answer = { data: (writes[name] ?? []).map(r => ({ ...r })), error: null }
        else {
          const all = source[name] || []
          const page = q.range ? all.slice(q.range[0], Math.min(q.range[1] + 1, q.range[0] + PAGE)) : all.slice(0, PAGE)
          answer = { data: page.map(r => ({ ...r })), error: null }
        }
        return Promise.resolve(answer).then(resolve, reject)
      },
    }
    return b
  }
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: ME } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (name) => builder(name, rows),
    rpc: (fn) => builder(fn, rpcRows),
  }
}

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))
const pad = (i) => String(i).padStart(5, '0')
let adapter

beforeEach(() => {
  resetSupabaseAdapter()
  adapter = supabaseAdapter()
})
afterEach(() => { delete globalThis.__testSupabase })

describe('🚨 Moth\'s Session 3 lists are read whole, past PostgREST\'s 1,000 rows', () => {
  it('2,345 uses, 1,001 tags, 1,001 types and 1,001 nominations come back every one, a page at a time, the id last in each order', async () => {
    const client = makeClient({ rows: {
      moth_tag_assignments: many(2345, (i) => ({ id: `a${pad(i)}`, tag_id: 't1', tier: 'company', target_type: 'shot', target_id: `s${i}` })),
      moth_tags: many(1001, (i) => ({ id: `t${pad(i)}`, label: `Tag ${pad(i)}` })),
      moth_tag_types: many(1001, (i) => ({ id: `y${pad(i)}`, name: `Type ${pad(i)}` })),
      moth_tag_nominations: many(1001, (i) => ({ id: `n${pad(i)}`, label: `Tag ${pad(i)}` })),
    } })
    globalThis.__testSupabase = client
    const uses = await adapter.listMothTagAssignments()
    expect(uses).toHaveLength(2345)
    expect(uses.at(-1).id).toBe('a02344')
    expect(uses.truncated).not.toBe(true)
    expect(await adapter.listMothTags()).toHaveLength(1001)
    expect(await adapter.listMothTagTypes()).toHaveLength(1001)
    expect(await adapter.listMothTagNominations()).toHaveLength(1001)
    const pagesOf = (t) => client.calls.filter(c => c.name === t).map(c => c.range)
    expect(pagesOf('moth_tag_assignments')).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(pagesOf('moth_tags')).toEqual([[0, 999], [1000, 1999]])
    for (const c of client.calls) expect(c.orders.at(-1), c.name).toBe('id')
    expect(client.calls.find(c => c.name === 'moth_tag_assignments').orders).toEqual(['created_at', 'id'])
    expect(client.calls.find(c => c.name === 'moth_tags').orders).toEqual(['label', 'id'])
    expect(client.calls.find(c => c.name === 'moth_tag_types').orders).toEqual(['name', 'id'])
    expect(client.calls.find(c => c.name === 'moth_tag_nominations').orders).toEqual(['created_at', 'id'])
  })

  it('past 20,000 uses the list stops at its bound and says it was cut', async () => {
    globalThis.__testSupabase = makeClient({ rows: {
      moth_tag_assignments: many(20050, (i) => ({ id: `a${pad(i)}`, tag_id: 't1', target_type: 'shot', target_id: `s${i}` })),
    } })
    const uses = await adapter.listMothTagAssignments()
    expect(uses).toHaveLength(20000)
    expect(uses.truncated).toBe(true)
  })

  it('CONTROL: exactly 20,000 uses is whole, and not called cut', async () => {
    globalThis.__testSupabase = makeClient({ rows: {
      moth_tag_assignments: many(20000, (i) => ({ id: `a${pad(i)}` })),
    } })
    const uses = await adapter.listMothTagAssignments()
    expect(uses).toHaveLength(20000)
    expect(uses.truncated).not.toBe(true)
  })

  it('one thing\'s uses still ask for that thing alone', async () => {
    const client = makeClient({ rows: { moth_tag_assignments: [{ id: 'a1' }] } })
    globalThis.__testSupabase = client
    expect(await adapter.listMothTagAssignments({ targetKind: 'asset', targetId: 'x1' })).toEqual([{ id: 'a1' }])
    expect(client.calls[0].filters).toEqual([['eq', 'target_type', 'asset'], ['eq', 'target_id', 'x1']])
  })

  it('1,800 workspace notes come back every one, the newest first, paged on moth_notes itself', async () => {
    const client = makeClient({ rpcRows: {
      moth_notes: many(1800, (i) => ({ id: `n${pad(i)}`, title: `Note ${i}`, tier: 'shared' })),
    } })
    globalThis.__testSupabase = client
    const notes = await adapter.listMothNotes()
    expect(notes).toHaveLength(1800)
    expect(notes.at(-1).id).toBe('n01799')
    const asked = client.calls.filter(c => c.name === 'moth_notes')
    expect(asked.map(c => c.range)).toEqual([[0, 999], [1000, 1999]])
    expect(asked[0].orders).toEqual(['updated_at', 'id'])
  })

  it('5,000 notes, the server\'s own bound, is said to be cut', async () => {
    globalThis.__testSupabase = makeClient({ rpcRows: { moth_notes: many(5000, (i) => ({ id: `n${pad(i)}` })) } })
    const notes = await adapter.listMothNotes()
    expect(notes).toHaveLength(5000)
    expect(notes.truncated).toBe(true)
  })
})

describe('🚨 a change the database made to no row is refused in words', () => {
  const refused = (p) => expect(p).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/^That .* (change|delete)/) })

  it('a rename or a retire of a tag no longer one\'s to change', async () => {
    globalThis.__testSupabase = makeClient()
    await refused(adapter.updateMothTag('t1', { label: 'Hero' }))
    await refused(adapter.updateMothTag('t1', { retired: true }))
  })

  it('a type\'s change, and a delete of a tag or type that matched nothing', async () => {
    globalThis.__testSupabase = makeClient()
    await refused(adapter.updateMothTagType('y1', { name: 'Cast' }))
    await refused(adapter.deleteMothTag('t1'))
    await refused(adapter.deleteMothTagType('y1'))
  })

  it('a label on a link typed in a field (the policy takes drawn links only)', async () => {
    globalThis.__testSupabase = makeClient()
    await refused(adapter.updateMothRelationshipLabel('l1', 'reference'))
  })

  it('CONTROL: a change that landed answers its row, a delete that did says so', async () => {
    globalThis.__testSupabase = makeClient({ writes: {
      moth_tags: [{ id: 't1', label: 'Hero' }], moth_tag_types: [{ id: 'y1', name: 'Cast' }], moth_relationships: [{ id: 'l1', label: 'see' }],
    } })
    expect(await adapter.updateMothTag('t1', { label: 'Hero' })).toEqual({ id: 't1', label: 'Hero' })
    expect(await adapter.updateMothTagType('y1', { name: 'Cast' })).toEqual({ id: 'y1', name: 'Cast' })
    expect(await adapter.updateMothRelationshipLabel('l1', 'see')).toEqual({ id: 'l1', label: 'see' })
    expect(await adapter.deleteMothTag('t1')).toEqual({ removed: true })
  })
})

describe('🚨 the notes\' tier probe (0125) is not trusted past its answer', () => {
  const noColumn = { data: null, error: { code: '42703', message: 'column notes.tier does not exist' } }

  it('a client open across the apply sees the tiers once they are there', async () => {
    let applied = false
    const client = makeClient({ rows: { notes: [] }, probe: () => (applied ? { data: [], error: null } : noColumn) })
    globalThis.__testSupabase = client
    expect(await adapter.notesHaveTiers()).toBe(false)
    applied = true
    expect(await adapter.notesHaveTiers()).toBe(true)
    await adapter.listNotes({ scope: 'mine' })
    const read = client.calls.filter(c => c.name === 'notes' && c.cols !== 'tier').at(-1)
    expect(read.filters).toContainEqual(['eq', 'owner_id', ME])
    expect(read.filters).toContainEqual(['is', 'deleted_at', null])
  })

  it('one\'s own list and a subject\'s rename ask for one\'s own notes, even on a database before 0125', async () => {
    const client = makeClient({ rows: { notes: [] }, probe: () => noColumn })
    globalThis.__testSupabase = client
    await adapter.listNotes({ scope: 'mine' })
    await adapter.retagNoteSubject('Old', 'New')
    const [list, retag] = client.calls.filter(c => c.name === 'notes' && c.cols !== 'tier')
    expect(list.filters).toContainEqual(['eq', 'owner_id', ME])
    expect(retag.op).toBe('update')
    expect(retag.filters).toContainEqual(['eq', 'owner_id', ME])
    expect(retag.filters.some(f => f[1] === 'tier')).toBe(false)
  })

  it('an unrelated failure that holds the word "tier" is not taken for an old database', async () => {
    globalThis.__testSupabase = makeClient({ probe: () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout (tier read)' } }) })
    await expect(adapter.listNotes({ scope: 'mine' })).rejects.toMatchObject({ code: '57014' })
  })
})
