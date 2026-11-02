// =============================================================================
// projectChannels.test.js — MO1 (migration 0109, MOTH_DESIGN §2.6 R11): the
// adapter's half of the private-project channels. The project channel's name
// carries the project's topic epoch (rabbit:project:{id} at 0,
// rabbit:project:{id}:{n} after a narrowing); both channels bind the
// payload-free AUDIENCE event and forward it as a projects AUDIENCE; the
// project list reads topic_epoch only where the column exists (a database
// without 0107 lists as before).
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter, projectTopicName } = await import('./supabaseAdapter')

/** A client with a projects table (with or without topic_epoch) and channels that record their bindings. */
function makeClient({ hasEpoch = true } = {}) {
  const channels = []
  const selects = []
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'u1@test.local', user_metadata: {} } } } }) },
    realtime: { setAuth: async () => {} },
    channel(name, config) {
      const ch = {
        name, config, handlers: [],
        on(kind, filter, fn) { ch.handlers.push({ kind, event: filter?.event, fn }); return ch },
        subscribe() { return ch },
        unsubscribe() {},
        presenceState: () => ({}),
        track: async () => {},
      }
      channels.push(ch)
      return ch
    },
    removeChannel() {},
    from(table) {
      let cols = null
      const b = {
        select: (c) => { cols = c; selects.push({ table, cols: c }); return b },
        limit: () => b,
        order: () => b,
        then: (resolve) => {
          if (/topic_epoch/.test(cols || '') && !hasEpoch) {
            return resolve({ data: null, error: { code: '42703', message: 'column projects.topic_epoch does not exist' } })
          }
          return resolve({ data: [], error: null })
        },
      }
      return b
    },
  }
  return { client, channels, selects }
}

const broadcastEvents = (ch) => ch.handlers.filter(h => h.kind === 'broadcast').map(h => h.event).sort()

let fake
beforeEach(() => { resetSupabaseAdapter(); fake = makeClient(); globalThis.__testSupabase = fake.client })
afterEach(() => { delete globalThis.__testSupabase; resetSupabaseAdapter() })

describe('projectTopicName', () => {
  it('epoch 0 keeps the name every build has used; a narrowing adds the epoch', () => {
    expect(projectTopicName('p1')).toBe('rabbit:project:p1')
    expect(projectTopicName('p1', 0)).toBe('rabbit:project:p1')
    expect(projectTopicName('p1', 1)).toBe('rabbit:project:p1:1')
    expect(projectTopicName('p1', 12)).toBe('rabbit:project:p1:12')
  })
  it('anything that is not a positive integer joins epoch 0', () => {
    for (const bad of [undefined, null, -1, 1.5, '2', NaN]) expect(projectTopicName('p1', bad)).toBe('rabbit:project:p1')
  })
})

describe('subscribeProjectChanges (0109)', () => {
  it('joins the topic its epoch names', async () => {
    const off = supabaseAdapter().subscribeProjectChanges('p1', () => {}, { topicEpoch: 2 })
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1))
    expect(fake.channels[0].name).toBe('rabbit:project:p1:2')
    off()
  })
  it('joins the plain topic without an epoch', async () => {
    const off = supabaseAdapter().subscribeProjectChanges('p1', () => {})
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1))
    expect(fake.channels[0].name).toBe('rabbit:project:p1')
    off()
  })
  it('binds AUDIENCE beside the three writes and forwards it with no row', async () => {
    const seen = []
    const off = supabaseAdapter().subscribeProjectChanges('p1', (evt) => seen.push(evt))
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1))
    expect(broadcastEvents(fake.channels[0])).toEqual(['AUDIENCE', 'DELETE', 'INSERT', 'UPDATE'])
    fake.channels[0].handlers.find(h => h.event === 'AUDIENCE').fn({ payload: { table: 'projects', operation: 'AUDIENCE', record: null, old_record: null } })
    expect(seen).toEqual([{ table: 'projects', op: 'AUDIENCE', record: null, oldRecord: null }])
    off()
  })
})

describe('subscribeWorkspaceChanges (0109)', () => {
  it('binds AUDIENCE and forwards it as a projects AUDIENCE with no row', async () => {
    const seen = []
    const off = supabaseAdapter().subscribeWorkspaceChanges('ws1', (evt) => seen.push(evt))
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1))
    expect(fake.channels[0].name).toBe('rabbit:workspace:ws1')
    expect(broadcastEvents(fake.channels[0])).toEqual(['AUDIENCE', 'DELETE', 'INSERT', 'UPDATE'])
    fake.channels[0].handlers.find(h => h.event === 'AUDIENCE').fn({ payload: {} })
    expect(seen).toEqual([{ table: 'projects', op: 'AUDIENCE', record: null, oldRecord: null }])
    off()
  })
})

describe('listProjects and topic_epoch', () => {
  const listCols = () => fake.selects.filter(s => s.table === 'projects' && /^id, title/.test(s.cols)).map(s => s.cols)
  it('reads topic_epoch where the column exists', async () => {
    await supabaseAdapter().listProjects()
    expect(listCols()).toHaveLength(1)
    expect(listCols()[0]).toMatch(/, topic_epoch$/)
  })
  it('lists as before on a database without it (no 42703 on the whole list)', async () => {
    fake = makeClient({ hasEpoch: false })
    globalThis.__testSupabase = fake.client
    await supabaseAdapter().listProjects()
    expect(listCols()).toHaveLength(1)
    expect(listCols()[0]).not.toMatch(/topic_epoch/)
  })
})
