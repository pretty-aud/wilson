// =============================================================================
// workspaceRemoteViewing.test.js — the company's switch read for the
// WORKSPACE (BC2 item 7): Settings, Storage shows it with or without an open
// project, so the cloud adapter reads workspaces.remote_viewing_enabled for
// the company signed in to (workspaces_select, 0002: every active member
// reads their own company's row).
//
// What this pins: the read names the workspace and the one column; a row
// that says true reads on, anything else (false, no row — another company's
// id, which RLS hides — or a database without 0091's column) reads OFF;
// any other error is said, not swallowed into "off".
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))
const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

function clientAnswering(result) {
  const calls = []
  const b = {
    select: (cols) => { calls.push(['select', cols]); return b },
    eq: (col, val) => { calls.push(['eq', col, val]); return b },
    maybeSingle: async () => result,
  }
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => { calls.push(['from', table]); return b },
  }
}

afterEach(() => { resetSupabaseAdapter(); delete globalThis.__testSupabase })

describe('getWorkspaceRemoteViewing', () => {
  it('reads the one column of the company\'s own row', async () => {
    const c = clientAnswering({ data: { remote_viewing_enabled: true }, error: null })
    globalThis.__testSupabase = c
    expect(await supabaseAdapter().getWorkspaceRemoteViewing('w1')).toBe(true)
    expect(c.calls).toEqual([['from', 'workspaces'], ['select', 'remote_viewing_enabled'], ['eq', 'id', 'w1']])
  })

  it('off unless the row says on: false, no row (another company), a database without the column, no workspace', async () => {
    globalThis.__testSupabase = clientAnswering({ data: { remote_viewing_enabled: false }, error: null })
    expect(await supabaseAdapter().getWorkspaceRemoteViewing('w1')).toBe(false)
    resetSupabaseAdapter(); globalThis.__testSupabase = clientAnswering({ data: null, error: null })
    expect(await supabaseAdapter().getWorkspaceRemoteViewing('w-other')).toBe(false)
    resetSupabaseAdapter(); globalThis.__testSupabase = clientAnswering({ data: null, error: { code: '42703', message: 'column workspaces.remote_viewing_enabled does not exist' } })
    expect(await supabaseAdapter().getWorkspaceRemoteViewing('w1')).toBe(false)
    expect(await supabaseAdapter().getWorkspaceRemoteViewing(null)).toBe(false)
  })

  it('any other error is said, not read as "off"', async () => {
    globalThis.__testSupabase = clientAnswering({ data: null, error: { code: '08006', message: 'connection lost' } })
    const err = await supabaseAdapter().getWorkspaceRemoteViewing('w1').catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('connection lost')
  })
})
