// =============================================================================
// taskItemsCloud.test.js — FX2 (migration 0096): the cloud adapter's half of a
// task's items, against a recording client.
//   * the load reads public.task_items (the shared shape, never the five
//     generated columns) and that read is the 0096 probe: a database without
//     the table answers no items and every items write refuses BEFORE any
//     request with code `task_items_unavailable`; a later load that finds the
//     table clears it;
//   * addTaskItem is ON CONFLICT (task, kind, entity) DO NOTHING, then — when
//     the task already named it — a read of the stored row;
//   * reorderTaskItems is the reorder_task_items RPC, its answer in the shared
//     shape; deleteTaskItem deletes by id;
//   * the allowlist names what a client may write and never a generated column.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = []
function builder(table, results) {
  const record = { table, ops: [] }
  calls.push(record)
  const b = {}
  for (const op of ['select', 'eq', 'order', 'range', 'single', 'maybeSingle', 'upsert', 'insert', 'delete', 'update', 'in']) {
    b[op] = (...args) => { record.ops.push([op, ...args]); return b }
  }
  b.then = (resolve, reject) => {
    const kind = record.ops.some(o => o[0] === 'upsert') ? 'upsert'
      : record.ops.some(o => o[0] === 'delete') ? 'delete'
      : record.ops.some(o => o[0] === 'maybeSingle') ? 'maybeSingle' : 'select'
    const r = typeof results === 'function' ? results(kind, record) : (results?.[kind] ?? { data: [], error: null })
    return Promise.resolve(r).then(resolve, reject)
  }
  return b
}
function makeClient(perTable = {}, rpc = null) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => builder(table, perTable[table] ?? (table === 'projects'
      ? { select: { data: { id: 'p1', title: 'P' }, error: null } } : undefined)),
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpc ? rpc(name, args) : { data: [], error: null } },
  }
}

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const mod = await import('./supabaseAdapter')
const { supabaseAdapter, resetSupabaseAdapter, resetTaskItemsSchemaState, COLUMN_ALLOWLIST, TASK_ITEMS_REFUSALS } = mod

const STORED = { id: 'i1', task_id: 't1', project_id: 'p1', workspace_id: 'w1', entity_type: 'asset', entity_id: 'a1', position: 0, created_at: '2026-10-11T00:00:00Z' }

beforeEach(() => {
  calls.length = 0
  resetSupabaseAdapter()
  resetTaskItemsSchemaState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  resetTaskItemsSchemaState()
  delete globalThis.__testSupabase
  vi.restoreAllMocks()
})

describe('the load and the 0096 probe', () => {
  it('reads task_items in the shared shape, in 0096\'s order, and answers taskItems', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { select: { data: [STORED], error: null } } })
    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.taskItems).toEqual([STORED])
    const read = calls.find(c => c.table === 'task_items')
    const select = read.ops.find(o => o[0] === 'select')[1]
    expect(select.split(',').map(s => s.trim())).toEqual(
      ['id', 'task_id', 'project_id', 'workspace_id', 'entity_type', 'entity_id', 'position', 'created_at', 'created_by', 'updated_at', 'updated_by'])
    for (const generated of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) expect(select).not.toContain(generated)
    expect(read.ops.filter(o => o[0] === 'order').map(o => o[1])).toEqual(['task_id', 'entity_type', 'position', 'created_at', 'id'])
    expect(supabaseAdapter().taskItemsAvailable()).toBe(true)
  })

  it('a database without the table answers no items, and every items write refuses before any request', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { select: { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.task_items'" } } } })
    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.taskItems).toEqual([])
    expect(supabaseAdapter().taskItemsAvailable()).toBe(false)
    calls.length = 0
    await expect(supabaseAdapter().addTaskItem({ task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a1' }))
      .rejects.toMatchObject({ code: 'task_items_unavailable', message: expect.stringMatching(/migration 0096/) })
    await expect(supabaseAdapter().deleteTaskItem('i1')).rejects.toMatchObject({ code: 'task_items_unavailable' })
    await expect(supabaseAdapter().reorderTaskItems('p1', 't1', 'asset', [])).rejects.toMatchObject({ code: 'task_items_unavailable' })
    expect(calls).toEqual([])
  })

  it('a later load that finds the table clears it (a database migrated mid-session)', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { select: { data: null, error: { code: '42P01', message: 'relation "public.task_items" does not exist' } } } })
    await supabaseAdapter().loadProject('p1')
    expect(supabaseAdapter().taskItemsAvailable()).toBe(false)
    globalThis.__testSupabase = makeClient({ task_items: { select: { data: [], error: null } } })
    // A new client (as a sign-in makes): the adapter's own state is reset, the
    // schema flag on purpose is not (auth events do not change the schema).
    resetSupabaseAdapter()
    expect(supabaseAdapter().taskItemsAvailable()).toBe(false)
    await supabaseAdapter().loadProject('p1')
    expect(supabaseAdapter().taskItemsAvailable()).toBe(true)
  })

  it('any other refusal of the read still throws (a refused read is not "no items")', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { select: { data: null, error: { code: '42501', message: 'permission denied for table task_items' } } } })
    await expect(supabaseAdapter().loadProject('p1')).rejects.toThrow(/permission denied/)
  })
})

describe('the writes', () => {
  it('addTaskItem is ON CONFLICT (task, kind, entity) DO NOTHING and sends only what a client may write', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: [STORED], error: null } } })
    const row = await supabaseAdapter().addTaskItem({ ...STORED, workspace_id: 'forged', asset_id: 'forged', created_by: 'forged' })
    expect(row).toEqual(STORED)
    const up = calls.find(c => c.table === 'task_items').ops.find(o => o[0] === 'upsert')
    expect(up[2]).toEqual({ onConflict: 'task_id,entity_type,entity_id', ignoreDuplicates: true })
    expect(Object.keys(up[1]).sort()).toEqual(['created_at', 'entity_id', 'entity_type', 'id', 'position', 'project_id', 'task_id'])
  })

  it('when the task already named it, the stored row is read and answered', async () => {
    const stored = { ...STORED, id: 'theirs' }
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: [], error: null }, maybeSingle: { data: stored, error: null } } })
    const row = await supabaseAdapter().addTaskItem({ ...STORED, id: 'mine' })
    expect(row).toEqual(stored)
    const read = calls.filter(c => c.table === 'task_items')[1]
    expect(read.ops.filter(o => o[0] === 'eq').map(o => [o[1], o[2]])).toEqual([['task_id', 't1'], ['entity_type', 'asset'], ['entity_id', 'a1']])
  })

  it('a refusal keeps its SQLSTATE; a missing table becomes task_items_unavailable and is remembered', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: null, error: { code: '23514', message: 'new row for relation "task_items" violates check constraint "task_items_position_check"' } } } })
    await expect(supabaseAdapter().addTaskItem(STORED)).rejects.toMatchObject({ code: '23514', message: expect.stringMatching(/^\[supabase\] new row for relation/) })
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: null, error: { code: 'PGRST205', message: 'no table' } } } })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().addTaskItem(STORED)).rejects.toMatchObject({ code: 'task_items_unavailable' })
    expect(supabaseAdapter().taskItemsAvailable()).toBe(false)
  })

  // Review round 1, R1-3: the two refusals an items write meets, in words
  // (the SQLSTATE kept): the item gate, and the task's main item becoming a
  // row the task cannot be seen under (a trashed asset), raised by 0096's
  // trigger as the tasks UPDATE it makes.
  it('the item gate and a main item the task cannot stand on read as sentences, the SQLSTATE kept', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "task_items"' } } } })
    await expect(supabaseAdapter().addTaskItem(STORED)).rejects.toMatchObject({ code: '42501', message: TASK_ITEMS_REFUSALS.gate })
    globalThis.__testSupabase = makeClient({ task_items: { delete: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' } } } })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().deleteTaskItem('i1')).rejects.toMatchObject({ code: '42501', message: TASK_ITEMS_REFUSALS.mainHidden })
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' } }))
    resetSupabaseAdapter()
    await expect(supabaseAdapter().reorderTaskItems('p1', 't1', 'asset', ['i2', 'i1'])).rejects.toMatchObject({ code: '42501', message: TASK_ITEMS_REFUSALS.mainHidden })
    // Review round 2, R2-5: two writers of one task can deadlock (0096 §7a
    // locks the task row); Postgres takes one back whole.
    globalThis.__testSupabase = makeClient({ task_items: { delete: { data: null, error: { code: '40P01', message: 'deadlock detected' } } } })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().deleteTaskItem('i1')).rejects.toMatchObject({ code: '40P01', message: TASK_ITEMS_REFUSALS.collided })
  })

  it('deleteTaskItem deletes by id', async () => {
    globalThis.__testSupabase = makeClient({ task_items: { delete: { data: null, error: null } } })
    await supabaseAdapter().deleteTaskItem('i9')
    const del = calls.find(c => c.table === 'task_items')
    expect(del.ops.map(o => o[0])).toEqual(['delete', 'eq'])
    expect(del.ops[1]).toEqual(['eq', 'id', 'i9'])
  })

  it('reorderTaskItems is the RPC, its answer in the shared shape (the generated columns dropped)', async () => {
    globalThis.__testSupabase = makeClient({}, () => ({ data: [{ ...STORED, position: 1, asset_id: 'a1', scene_id: null, shot_id: null, level_id: null, experience_id: null }], error: null }))
    const moved = await supabaseAdapter().reorderTaskItems('p1', 't1', 'asset', ['i2', 'i1'])
    expect(calls).toEqual([{ rpc: 'reorder_task_items', args: { p_task: 't1', p_entity_type: 'asset', p_ids: ['i2', 'i1'] } }])
    expect(moved).toEqual([{ ...STORED, position: 1 }])
  })

  it('a missing reorder function becomes task_items_unavailable', async () => {
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reorder_task_items' } }))
    await expect(supabaseAdapter().reorderTaskItems('p1', 't1', 'asset', [])).rejects.toMatchObject({ code: 'task_items_unavailable' })
  })
})

describe('the allowlist', () => {
  it('task_items names the columns a client may write, and no generated column', () => {
    const allow = COLUMN_ALLOWLIST.task_items
    expect(allow).toBeDefined()
    for (const c of ['id', 'task_id', 'project_id', 'entity_type', 'entity_id', 'position']) expect(allow.has(c), c).toBe(true)
    for (const g of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) expect(allow.has(g), g).toBe(false)
  })
  it('tasks still has no level_id or experience_id column (a task\'s level and experience live in task_items)', () => {
    expect(COLUMN_ALLOWLIST.tasks.has('level_id')).toBe(false)
    expect(COLUMN_ALLOWLIST.tasks.has('experience_id')).toBe(false)
  })
})
