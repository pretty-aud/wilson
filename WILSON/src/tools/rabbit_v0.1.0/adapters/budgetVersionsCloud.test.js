// =============================================================================
// budgetVersionsCloud.test.js — post-overhaul S5 on the cloud adapter (0089).
//
//   patchBudgetVersion   an UPDATE of only the named columns, filtered to the
//                        row AND its project; no row back is the money gate's
//                        refusal (an UPDATE RLS filters returns nothing).
//   selectBudgetVersion  0089's select_budget_version RPC, one statement.
//   createProject        drops open_budget_version_id (a new project has no
//                        versions; a copied row would name another's).
//   the allowlist        keeps open_budget_version_id on projects.
// The fake client records what would have reached PostgREST, and each claim
// has a control.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter, COLUMN_ALLOWLIST, toColumns } = await import('./supabaseAdapter')

function makeClient({ updateRows = (payload) => [{ id: 'bv1', ...payload }] } = {}) {
  const calls = []
  const table = (name) => {
    const rec = { table: name, op: 'select', payload: null, filters: [] }
    const b = {
      select: () => b,
      eq: (col, val) => { rec.filters.push([col, val]); return b },
      single: () => b,
      limit: () => b,
      update: (row) => { rec.op = 'update'; rec.payload = row; return b },
      insert: (row) => { rec.op = 'insert'; rec.payload = row; return b },
      then: (resolve, reject) => {
        calls.push(rec)
        let result = { data: [], error: null }
        if (rec.op === 'update') result = { data: updateRows(rec.payload), error: null }
        if (rec.op === 'insert') result = { data: { id: 'p-new', ...rec.payload }, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }
  return {
    calls,
    rpcs: [],
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (name) => table(name),
    async rpc(name, args) { this.rpcs.push([name, args]); return { data: args.p_version ?? null, error: null } },
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

describe('patchBudgetVersion — only the columns a change names', () => {
  it('sends an UPDATE of the named columns, filtered to the row and its project', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    await supabaseAdapter().patchBudgetVersion('p1', 'bv1', { snapshot: { kind: 'bid' }, summary: 'n', id: 'bv1', project_id: 'p1', created_at: 'x', updated_at: 'y' })
    const upd = client.calls.find(c => c.op === 'update')
    expect(upd.table).toBe('budget_versions')
    expect(upd.payload).toEqual({ snapshot: { kind: 'bid' }, summary: 'n' })
    expect(upd.filters).toEqual([['id', 'bv1'], ['project_id', 'p1']])
  })
  it('no row back is a refusal in words (the money gate filtered the UPDATE), not a silent no-op', async () => {
    const client = makeClient({ updateRows: () => [] })
    globalThis.__testSupabase = client
    await expect(supabaseAdapter().patchBudgetVersion('p1', 'bv1', { name: 'x' })).rejects.toMatchObject({ code: '42501' })
  })
  it('CONTROL: a patch that names nothing writable sends nothing', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().patchBudgetVersion('p1', 'bv1', { id: 'bv1', created_at: 'x' })).toBeNull()
    expect(client.calls.filter(c => c.op === 'update')).toEqual([])
  })
})

describe('selectBudgetVersion — the RPC, one statement', () => {
  it('calls select_budget_version with the project and the version; null clears', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    expect(await supabaseAdapter().selectBudgetVersion('p1', 'bv2')).toBe('bv2')
    expect(await supabaseAdapter().selectBudgetVersion('p1', null)).toBeNull()
    expect(client.rpcs).toEqual([
      ['select_budget_version', { p_project: 'p1', p_version: 'bv2' }],
      ['select_budget_version', { p_project: 'p1', p_version: null }],
    ])
    // CONTROL: no per-row write goes out — the loop the client used to run.
    expect(client.calls.filter(c => c.table === 'budget_versions')).toEqual([])
  })
})

describe('the projects allowlist and createProject (0089)', () => {
  it('keeps open_budget_version_id on a projects write', () => {
    expect(COLUMN_ALLOWLIST.projects.has('open_budget_version_id')).toBe(true)
    expect(toColumns('projects', { title: 'T', open_budget_version_id: 'bv1' })).toEqual({ title: 'T', open_budget_version_id: 'bv1' })
  })
  it('createProject drops the pointer a copied row carries; CONTROL: the title goes', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    await supabaseAdapter().createProject({ title: 'Copy', open_budget_version_id: 'bv-of-another' })
    const ins = client.calls.find(c => c.op === 'insert' && c.table === 'projects')
    expect(ins.payload.title).toBe('Copy')
    expect(ins.payload).not.toHaveProperty('open_budget_version_id')
  })
})
