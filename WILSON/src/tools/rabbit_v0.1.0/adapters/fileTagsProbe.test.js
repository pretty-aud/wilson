// =============================================================================
// fileTagsProbe.test.js — post-overhaul S4a: the cloud adapter on a database
// with and WITHOUT files.tags (migration 0085).
//
// The beta keeps running on staging until Audrey applies 0085. On that
// database a PATCH naming `tags` would PGRST204 the whole request — the note
// typed beside it lost too. So updateFile probes the column once (0081's
// pattern: 42703 → absent) and strips `tags` when it is absent; a patch that
// was ONLY tags refuses in words instead of becoming a silent no-op.
//
// The fake client records every update payload, so each assertion is about
// what would have reached PostgREST — and the CONTROL shows that payload
// carrying `tags` when the column exists, so "stripped" is never "never sent".
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

/**
 * A client whose `files` table has (or lacks) the tags column. `probeErrors`
 * answers the first probes with these errors, in turn, before the table's
 * real answer (round 1, R1-SEC-05).
 */
function makeClient({ hasTags, probeErrors = [] }) {
  const updates = []
  const probes = []
  const rpcs = []
  const queued = [...probeErrors]
  const files = () => {
    let op = 'select'
    let payload = null
    let cols = '*'
    const b = {
      select: (c) => { if (op === 'select') cols = c ?? '*'; return b },
      limit: () => b,
      eq: () => b,
      single: () => b,
      update: (row) => { op = 'update'; payload = row; return b },
      then: (resolve, reject) => {
        let result
        if (op === 'select' && cols === 'tags') {
          probes.push(cols)
          result = queued.length
            ? { data: null, error: queued.shift() }
            : hasTags
              ? { data: [], error: null }
              : { data: null, error: { code: '42703', message: 'column files.tags does not exist' } }
        } else if (op === 'update') {
          updates.push(payload)
          result = { data: { id: 'f1', ...payload }, error: null }
        } else {
          result = { data: [], error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  return {
    updates, probes, rpcs,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => {
      if (table !== 'files') throw new Error(`unexpected table ${table}`)
      return files()
    },
    rpc: async (name, args) => { rpcs.push([name, args]); return { data: null, error: null } },
  }
}

let warn
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetSupabaseAdapter()
})
afterEach(() => {
  resetSupabaseAdapter()
  delete globalThis.__testSupabase
  warn.mockRestore()
})

describe('updateFile and files.tags', () => {
  it('CONTROL: on a database WITH 0085 the tags reach PostgREST', async () => {
    const client = makeClient({ hasTags: true })
    globalThis.__testSupabase = client
    await supabaseAdapter().updateFile('f1', { tags: ['shots'], description: 'n', project_id: 'p1' })
    expect(client.updates).toEqual([{ tags: ['shots'], description: 'n', project_id: 'p1' }])
    expect(await supabaseAdapter().supportsFileTags()).toBe(true)
  })

  it('WITHOUT 0085 the tags are stripped and the rest still saves', async () => {
    const client = makeClient({ hasTags: false })
    globalThis.__testSupabase = client
    await supabaseAdapter().updateFile('f1', { tags: ['shots'], description: 'n', project_id: 'p1' })
    expect(client.updates).toEqual([{ description: 'n', project_id: 'p1' }])
    expect(await supabaseAdapter().supportsFileTags()).toBe(false)
  })

  it('WITHOUT 0085 a tags-only patch refuses in words and writes nothing', async () => {
    const client = makeClient({ hasTags: false })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().updateFile('f1', { tags: ['shots'], project_id: 'p1' }))
      .rejects.toThrow(/Tags are not on this database yet \(migration 0085\)/)
    expect(client.updates).toEqual([])
  })

  it('a patch without tags never probes (the description edit costs no extra round trip)', async () => {
    const client = makeClient({ hasTags: false })
    globalThis.__testSupabase = client
    await supabaseAdapter().updateFile('f1', { description: 'n', project_id: 'p1' })
    expect(client.probes).toEqual([])
    expect(client.updates).toEqual([{ description: 'n', project_id: 'p1' }])
  })

  it('an unrelated error that merely says "tags" is NOT remembered as "absent" (round 1, R1-SEC-05)', async () => {
    const client = makeClient({ hasTags: true, probeErrors: [{ code: 'XX000', message: 'too many tags requests, try again' }] })
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().supportsFileTags()).toBe(false) // not now…
    expect(await supabaseAdapter().supportsFileTags()).toBe(true)  // …probed again, and the column is there
    expect(client.probes.length).toBe(2)
    await supabaseAdapter().updateFile('f1', { tags: ['shots'], project_id: 'p1' })
    expect(client.updates).toEqual([{ tags: ['shots'], project_id: 'p1' }])
  })

  it('CONTROL: the missing-column sentence alone (no code) IS remembered as "absent"', async () => {
    const client = makeClient({ hasTags: true, probeErrors: [{ message: 'column files.tags does not exist' }] })
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().supportsFileTags()).toBe(false)
    expect(await supabaseAdapter().supportsFileTags()).toBe(false)
    expect(client.probes.length).toBe(1)
  })

  it('the answer is remembered for the session, and resetSupabaseAdapter forgets it', async () => {
    const client = makeClient({ hasTags: false })
    globalThis.__testSupabase = client
    await supabaseAdapter().supportsFileTags()
    await supabaseAdapter().supportsFileTags()
    expect(client.probes.length).toBe(1)
    resetSupabaseAdapter()
    await supabaseAdapter().supportsFileTags()
    expect(client.probes.length).toBe(2)
  })
})

describe('logFileDownloaded (E13: a preview is a read)', () => {
  it('calls the same RPC the downloads call, with the file id', async () => {
    const client = makeClient({ hasTags: true })
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().logFileDownloaded({ id: 'f9' })).toBe(true)
    expect(client.rpcs).toEqual([['log_file_downloaded', { p_file_id: 'f9' }]])
  })

  it('is best-effort: an RPC error is warned, never thrown', async () => {
    const client = makeClient({ hasTags: true })
    client.rpc = async () => ({ data: null, error: { message: 'denied' } })
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().logFileDownloaded({ id: 'f9' })).toBe(false)
    expect(warn).toHaveBeenCalledWith('[supabase] preview not logged:', 'denied')
  })
})
