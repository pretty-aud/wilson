// =============================================================================
// taskItemsCloud.test.js — FX2 (migration 0096): the cloud adapter's half of a
// task's items, against a recording client.
//   * the load reads public.task_items (the shared shape, never the five
//     generated columns) and that read is the 0096 probe: a database without
//     the table answers no items and every items write refuses BEFORE any
//     request with code `task_items_unavailable`; a later load that finds the
//     table clears it;
//   * addTaskItem is ON CONFLICT (task, kind, entity) DO NOTHING, then — when
//     the task already named it — a read of the stored row; deleteTaskItem
//     deletes by id;
//   * the allowlist names what a client may write and never a generated column.
// VW1m (2026-10-16, her ruling: a task's items are its items):
//   * no reorder on this client (her Q-N1: the window sorts, no Move
//     buttons); FX2's main-item refusal sentence is gone with the main item;
//   * listMyTasks (the Dashboard) embeds no asset through tasks.asset_id (the
//     older apps' copy): it reads the listed tasks' items in one request and
//     the names of what they name, one request per kind, and each task gains
//     `items: [{ kind, id, name }]`; a database without 0096 answers none.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = []
function builder(table, results) {
  const record = { table, ops: [] }
  calls.push(record)
  const b = {}
  for (const op of ['select', 'eq', 'order', 'range', 'single', 'maybeSingle', 'upsert', 'insert', 'delete', 'update', 'in', 'or']) {
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

  // Review round 1, R1-3: the refusals an items write meets, in words (the
  // SQLSTATE kept). VW1m (2026-10-16): FX2's third sentence (the task's main
  // item on a row it cannot stand on) went with the main item: 0097 takes the
  // asset arm out of tasks_select, so a refusal on "tasks" keeps Postgres'
  // own words, as any refusal not named.
  it('the item gate and a collision read as sentences, the SQLSTATE kept; nothing speaks of a main item', async () => {
    expect(Object.keys(TASK_ITEMS_REFUSALS).sort()).toEqual(['collided', 'gate'])
    for (const words of Object.values(TASK_ITEMS_REFUSALS)) expect(words).not.toMatch(/\bmain\b/i)
    globalThis.__testSupabase = makeClient({ task_items: { upsert: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "task_items"' } } } })
    await expect(supabaseAdapter().addTaskItem(STORED)).rejects.toMatchObject({ code: '42501', message: TASK_ITEMS_REFUSALS.gate })
    globalThis.__testSupabase = makeClient({ task_items: { delete: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' } } } })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().deleteTaskItem('i1')).rejects.toMatchObject({
      code: '42501', message: '[supabase] new row violates row-level security policy for table "tasks"',
    })
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

  it('VW1m: there is no reorder on this client (the database keeps reorder_task_items for older apps)', () => {
    globalThis.__testSupabase = makeClient()
    const a = supabaseAdapter()
    expect(a.reorderTaskItems).toBeUndefined()
    expect(Object.keys(a).filter(k => /^reorder/i.test(k) && /item/i.test(k) && !/shot|bin/i.test(k))).toEqual([])
  })
})

// ── The Dashboard: listMyTasks names every item (VW1m, 2026-10-16) ──────────
// Her Q-N6 (interim): every asset, "A, B". The fake answers each table's read
// from ROWS, filtered by the `.in()` the adapter sent, so a read that asks for
// the wrong ids answers the wrong names.
describe('listMyTasks: every item of every task, named (VW1m)', () => {
  const PROJECT = { id: 'p1', title: 'P', status: 'active' }
  const T1 = { id: 't1', project_id: 'p1', title: 'Rig', asset_id: 'a2', assignee_id: 'u1', project: PROJECT }
  const T2 = { id: 't2', project_id: 'p1', title: 'Comp', asset_id: null, reviewer_id: 'u1', project: PROJECT }
  const item = (id, task, kind, entity, position = 0) => ({ id, task_id: task, entity_type: kind, entity_id: entity, position, created_at: '2026-10-11T00:00:00Z' })
  const ROWS = {
    tasks: [T1, T2],
    task_items: [
      item('i1', 't1', 'asset', 'a2', 0), item('i2', 't1', 'asset', 'a1', 1),
      item('i3', 't1', 'asset', 'trashed', 2),
      item('i4', 't1', 'shot', 'h2'), item('i5', 't1', 'shot', 'h1', 1),
      item('i6', 't2', 'scene', 's2'), item('i7', 't2', 'level', 'l1'),
    ],
    // 'trashed' is an asset in the trash: RLS does not answer it.
    assets: [{ id: 'a1', name: 'Lighthouse Interior' }, { id: 'a2', name: 'Storm Lantern' }],
    shots: [{ id: 'h1', name: 'The door', shot_number: 10, scene_id: 's1' }, { id: 'h2', name: 'Rain on the glass', shot_number: 10, scene_id: 's4' }],
    scenes: [{ id: 's1', name: 'Lighthouse, dawn', scene_number: 1 }, { id: 's2', name: 'Cliff path', scene_number: 2 }, { id: 's4', name: 'The storm', scene_number: 4 }],
    levels: [{ id: 'l1', name: 'Lamp Room' }],
    experiences: [],
  }
  function answering(rows, errors = {}) {
    return makeClient(Object.fromEntries(Object.keys(rows).map(table => [table, (kind, record) => {
      if (errors[table]) return { data: null, error: errors[table] }
      const ins = record.ops.filter(o => o[0] === 'in')
      return { data: rows[table].filter(r => ins.every(([, col, vals]) => vals.map(String).includes(String(r[col])))), error: null }
    }])))
  }
  const readsOf = (table) => calls.filter(c => c.table === table)

  it('embeds the project only: no asset rides tasks.asset_id', async () => {
    globalThis.__testSupabase = answering(ROWS)
    await supabaseAdapter().listMyTasks()
    const select = readsOf('tasks')[0].ops.find(o => o[0] === 'select')[1]
    expect(select).toBe('*, project:projects(id,title,status)')
    expect(select).not.toMatch(/asset/)
  })

  it('reads the listed tasks\' items once, then one read per kind of what they name', async () => {
    globalThis.__testSupabase = answering(ROWS)
    await supabaseAdapter().listMyTasks()
    const items = readsOf('task_items')
    expect(items).toHaveLength(1)
    expect(items[0].ops.filter(o => o[0] === 'in')).toEqual([['in', 'task_id', ['t1', 't2']]])
    expect(items[0].ops.filter(o => o[0] === 'order').map(o => o[1])).toEqual(['task_id', 'entity_type', 'position', 'created_at', 'id'])
    for (const table of ['assets', 'scenes', 'shots', 'levels']) expect(readsOf(table), table).toHaveLength(1)
    expect(readsOf('experiences')).toHaveLength(0) // none is named
    expect(readsOf('assets')[0].ops.find(o => o[0] === 'in')[2].slice().sort()).toEqual(['a1', 'a2', 'trashed'])
    // A shot is named under its scene, so the one scenes read takes the
    // listed shots' scenes too.
    expect(readsOf('scenes')[0].ops.find(o => o[0] === 'in')[2].slice().sort()).toEqual(['s1', 's2', 's4'])
  })

  it('each task gains items: kinds in order, each kind in the display order, a shot under its scene, a trashed asset left out', async () => {
    globalThis.__testSupabase = answering(ROWS)
    const rows = await supabaseAdapter().listMyTasks()
    expect(rows.map(r => r.id)).toEqual(['t1', 't2'])
    expect(rows[0]).not.toHaveProperty('asset')
    expect(rows[0].project).toEqual(PROJECT)
    expect(rows[0].items).toEqual([
      // A to Z, not the stored order (Storm Lantern was added first).
      { kind: 'asset', id: 'a1', name: 'Lighthouse Interior' },
      { kind: 'asset', id: 'a2', name: 'Storm Lantern' },
      // By their scene's number, then their own.
      { kind: 'shot', id: 'h1', name: 'Lighthouse, dawn › The door' },
      { kind: 'shot', id: 'h2', name: 'The storm › Rain on the glass' },
    ])
    expect(rows[1].items).toEqual([
      { kind: 'scene', id: 's2', name: 'Cliff path' },
      { kind: 'level', id: 'l1', name: 'Lamp Room' },
    ])
  })

  it('CONTROL: a task with no item has none, and no tasks read nothing more', async () => {
    globalThis.__testSupabase = answering({ ...ROWS, task_items: [] })
    const rows = await supabaseAdapter().listMyTasks()
    expect(rows.map(r => r.items)).toEqual([[], []])
    for (const table of ['assets', 'scenes', 'shots', 'levels', 'experiences']) expect(readsOf(table), table).toHaveLength(0)
    calls.length = 0
    resetSupabaseAdapter()
    globalThis.__testSupabase = answering({ ...ROWS, tasks: [] })
    expect(await supabaseAdapter().listMyTasks()).toEqual([])
    expect(readsOf('task_items')).toHaveLength(0)
  })

  it('a database without 0096 answers no items (the tolerance the tasks read has), and reads no names', async () => {
    for (const error of [{ code: 'PGRST205', message: "Could not find the table 'public.task_items'" }, { code: '42P01', message: 'relation "public.task_items" does not exist' }]) {
      calls.length = 0
      resetSupabaseAdapter()
      globalThis.__testSupabase = answering(ROWS, { task_items: error })
      const rows = await supabaseAdapter().listMyTasks()
      expect(rows.map(r => [r.id, r.items]), error.code).toEqual([['t1', []], ['t2', []]])
      expect(readsOf('assets')).toHaveLength(0)
    }
  })

  it('a kind whose table is not there names none of that kind; the others still come', async () => {
    globalThis.__testSupabase = answering(ROWS, { levels: { code: 'PGRST205', message: "Could not find the table 'public.levels'" } })
    const rows = await supabaseAdapter().listMyTasks()
    expect(rows[1].items).toEqual([{ kind: 'scene', id: 's2', name: 'Cliff path' }])
  })

  it('any other refusal of the items read still throws (a refused read is not "no items")', async () => {
    globalThis.__testSupabase = answering(ROWS, { task_items: { code: '42501', message: 'permission denied for table task_items' } })
    await expect(supabaseAdapter().listMyTasks()).rejects.toThrow(/permission denied/)
  })

  // VW1m review round 1 (R1-6): every listed task's id went in one
  // `.in('task_id', …)` and every named row's in one `.in('id', …)`; a long
  // list passes the gateway's URL limit and the whole Dashboard load fails.
  // Each in-list goes 100 ids a request, the answers joined.
  it('R1-6: 250 tasks: no request carries more than 100 ids, and every task still gets its item', async () => {
    const many = Array.from({ length: 250 }, (_, n) => ({ id: `t${n}`, project_id: 'p1', title: `Task ${n}`, assignee_id: 'u1', project: PROJECT }))
    globalThis.__testSupabase = answering({
      ...ROWS,
      tasks: many,
      task_items: many.map((t, n) => item(`k${n}`, t.id, 'asset', `a${n}`)),
      assets: many.map((_, n) => ({ id: `a${n}`, name: `Asset ${n}` })),
    })
    const rows = await supabaseAdapter().listMyTasks()
    const ins = calls.filter(c => c.ops).flatMap(c => c.ops.filter(o => o[0] === 'in'))
    expect(ins.length).toBeGreaterThan(0)
    expect(Math.max(...ins.map(([, , ids]) => ids.length))).toBeLessThanOrEqual(100)
    expect(readsOf('task_items')).toHaveLength(3)
    expect(readsOf('assets')).toHaveLength(3)
    expect(rows).toHaveLength(250)
    expect(rows.filter((r, n) => r.items.length === 1 && r.items[0].id === `a${n}` && r.items[0].name === `Asset ${n}`)).toHaveLength(250)
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
