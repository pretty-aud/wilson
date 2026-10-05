// =============================================================================
// setAsideCloud.test.js — post-overhaul S5b, step 0, on the cloud adapter
// (migration 0090). Audrey's ruling (a): each bid version shows exactly its
// own schedule; rows it does not hold are SET ASIDE, never lost.
//
//   loadProject          splits the set-aside rows (and the edges on them) out
//                        of tasks / phases / milestones / dependencies — no
//                        SELECT policy hides them, so the client must
//   setAsideRows         0090's set_aside_schedule_rows, one RPC
//   ordinary writes      never carry the stamp (a stale copy must not bring a
//                        row back): upsertTask / Phase / Milestone, every patch
//   listMyTasks, listPhasesByProjects   the Dashboard's cross-project list
//                        hides them too
// The fake client records what would have reached PostgREST; each claim has a
// control.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

const AT = '2026-10-05T10:00:00+00:00'

function makeClient(data = {}) {
  const calls = []
  const table = (name) => {
    const rec = { table: name, op: 'select', payload: null }
    const b = {
      select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
      single: () => b, maybeSingle: () => b,
      update: (row) => { rec.op = 'update'; rec.payload = row; return b },
      upsert: (row) => { rec.op = 'upsert'; rec.payload = row; return b },
      insert: (row) => { rec.op = 'insert'; rec.payload = row; return b },
      then: (resolve, reject) => {
        calls.push(rec)
        let result
        if (rec.op === 'select') {
          const rows = typeof data[name] === 'function' ? data[name]() : data[name]
          result = { data: rows === undefined ? [] : rows, error: null }
        } else {
          result = { data: { id: rec.payload?.id || 'x', ...rec.payload }, error: null }
        }
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
    async rpc(name, args) {
      this.rpcs.push([name, args])
      if (name === 'set_aside_schedule_rows') {
        return { data: { set_aside_at: args.p_on ? AT : null, tasks: args.p_tasks.length, phases: args.p_phases.length, milestones: args.p_milestones.length }, error: null }
      }
      return { data: null, error: null }
    },
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

describe('loadProject — the set-aside rows split out (0090)', () => {
  const tables = {
    projects: { id: 'p1', title: 'P' },
    tasks: [{ id: 't1', project_id: 'p1' }, { id: 't2', project_id: 'p1', set_aside_at: AT }],
    phases: [{ id: 'ph1' }, { id: 'ph2', set_aside_at: AT }],
    milestones: [{ id: 'm1', set_aside_at: AT }, { id: 'm2' }],
    task_dependencies: [{ id: 'd1', predecessor_id: 't1', successor_id: 't2' }, { id: 'd3', predecessor_id: 't1', successor_id: 't1' }],
    phase_dependencies: [],
  }
  it('tasks / phases / milestones / dependencies hold the live schedule; the four set-aside keys the rest', async () => {
    globalThis.__testSupabase = makeClient(tables)
    const b = await supabaseAdapter().loadProject('p1')
    expect(b.tasks.map(r => r.id)).toEqual(['t1'])
    expect(b.phases.map(r => r.id)).toEqual(['ph1'])
    expect(b.milestones.map(r => r.id)).toEqual(['m2'])
    expect(b.dependencies.map(d => d.id)).toEqual(['d3'])
    expect(b.setAsideTasks.map(r => r.id)).toEqual(['t2'])
    expect(b.setAsidePhases.map(r => r.id)).toEqual(['ph2'])
    expect(b.setAsideMilestones.map(r => r.id)).toEqual(['m1'])
    expect(b.setAsideDependencies.map(d => d.id)).toEqual(['d1'])
  })
  it('CONTROL: a database without 0090 (no stamp anywhere) loads exactly as before', async () => {
    const plain = { ...tables, tasks: [{ id: 't1' }, { id: 't2' }], phases: [{ id: 'ph1' }, { id: 'ph2' }], milestones: [{ id: 'm2' }] }
    globalThis.__testSupabase = makeClient(plain)
    const b = await supabaseAdapter().loadProject('p1')
    expect(b.tasks.map(r => r.id)).toEqual(['t1', 't2'])
    expect(b.setAsideTasks).toEqual([])
    expect(b.dependencies.map(d => d.id)).toEqual(['d1', 'd3'])
  })
})

describe('setAsideRows — 0090\'s set_aside_schedule_rows', () => {
  it('one RPC with the project, the direction and the three id lists; answers the stamp and the counts', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const res = await supabaseAdapter().setAsideRows('p1', { on: true, tasks: ['t1', 't2'], phases: ['ph1'], milestones: [] })
    expect(client.rpcs).toEqual([['set_aside_schedule_rows', { p_project: 'p1', p_on: true, p_tasks: ['t1', 't2'], p_phases: ['ph1'], p_milestones: [] }]])
    expect(res).toEqual({ set_aside_at: AT, tasks: 2, phases: 1, milestones: 0 })
    const back = await supabaseAdapter().setAsideRows('p1', { on: false, tasks: ['t1'] })
    expect(back.set_aside_at).toBeNull()
    expect(client.rpcs.at(-1)[1].p_on).toBe(false)
  })
})

describe('ordinary writes never carry the stamp (a stale copy must not bring a row back)', () => {
  const stale = { set_aside_at: null }
  it('upsertTask, upsertPhase (phases have no allowlist), upsertMilestone', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const a = supabaseAdapter()
    await a.upsertTask({ id: 't1', project_id: 'p1', title: 'T', ...stale })
    await a.upsertPhase({ id: 'ph1', project_id: 'p1', name: 'P', ...stale })
    await a.upsertMilestone({ id: 'm1', project_id: 'p1', title: 'M', date: '2026-10-01', ...stale })
    const ups = client.calls.filter(c => c.op === 'upsert')
    expect(ups.map(c => c.table)).toEqual(['tasks', 'phases', 'milestones'])
    for (const c of ups) expect(c.payload).not.toHaveProperty('set_aside_at')
    // CONTROL: the rest of each row is sent.
    expect(ups[1].payload).toMatchObject({ id: 'ph1', name: 'P' })
    // And no "not a column" warning for it: the stamp IS a column, just never written here.
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/set_aside_at/)
  })
  it('every per-field patch', async () => {
    const client = makeClient()
    globalThis.__testSupabase = client
    const a = supabaseAdapter()
    await a.patchTask('t1', { title: 'T2', set_aside_at: null })
    await a.patchPhase('ph1', { name: 'P2', set_aside_at: AT })
    await a.patchMilestone('m1', { title: 'M2', set_aside_at: null })
    const upd = client.calls.filter(c => c.op === 'update')
    expect(upd).toHaveLength(3)
    for (const c of upd) expect(c.payload).not.toHaveProperty('set_aside_at')
    expect(upd[0].payload).toEqual({ title: 'T2' })
  })
})

describe('the Dashboard\'s cross-project list hides set-aside rows too', () => {
  it('listMyTasks and listPhasesByProjects leave them out', async () => {
    globalThis.__testSupabase = makeClient({
      tasks: [{ id: 't1', assignee_id: 'u1' }, { id: 't2', assignee_id: 'u1', set_aside_at: AT }],
      phases: [{ id: 'ph1', project_id: 'p1' }, { id: 'ph2', project_id: 'p1', set_aside_at: AT }],
    })
    const a = supabaseAdapter()
    expect((await a.listMyTasks()).map(t => t.id)).toEqual(['t1'])
    expect((await a.listPhasesByProjects(['p1'])).map(p => p.id)).toEqual(['ph1'])
  })
  it('CONTROL: without the stamp both come back whole', async () => {
    globalThis.__testSupabase = makeClient({
      tasks: [{ id: 't1', assignee_id: 'u1' }, { id: 't2', assignee_id: 'u1' }],
      phases: [{ id: 'ph1', project_id: 'p1' }, { id: 'ph2', project_id: 'p1' }],
    })
    const a = supabaseAdapter()
    expect((await a.listMyTasks()).map(t => t.id)).toEqual(['t1', 't2'])
    expect((await a.listPhasesByProjects(['p1'])).map(p => p.id)).toEqual(['ph1', 'ph2'])
  })
})
