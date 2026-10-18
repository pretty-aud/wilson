// =============================================================================
// tableViewsCloud.test.js — VW1c (migration 0098): the cloud adapter's half of
// custom table views and groupings, against a recording client. Nothing here
// touches a network or a database.
//   * the load reads public.table_views and public.item_groupings, PAGED, in
//     0098's orders, in the shared row shape — and those reads ARE the 0098
//     probe: 42P01 / PGRST205 answers both empty and marks the backend absent
//     (every write then refuses BEFORE any request, code
//     `table_views_unavailable`); ANY OTHER error answers both empty, the
//     project still opens, and tableViewsLoadError() says it in words until a
//     clean load; a later load that finds the tables clears the mark;
//   * every verb exactly per adapters/index.js's typedef: an INSERT for a new
//     view or grouping (never an upsert), the conditional save and delete with
//     the filters they actually send and the four answers (saved / removed,
//     deleted, changed, filtered — the row read ONCE), the reorder RPC, a
//     grouping's set already stored answered by a read of the set, the
//     removal's { removed }, the last used map's read (its own probe) and its
//     RPC;
//   * the refusals in words, the SQLSTATE kept on err.code;
//   * the allowlist (exactly 0098's column grants), the columns read (each one
//     0098 declares) and the parameter names sent (each one 0098 declares).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const calls = []
// A chainable, thenable builder: every op is recorded, and the answer is
// `answer(kind, record)` (or answer[kind]) where kind is what the chain is.
function builder(table, answer) {
  const record = { table, ops: [] }
  calls.push(record)
  const b = {}
  for (const op of ['select', 'eq', 'order', 'range', 'single', 'maybeSingle', 'insert', 'update', 'delete', 'upsert', 'contains', 'containedBy', 'in', 'is', 'limit']) {
    b[op] = (...args) => { record.ops.push([op, ...args]); return b }
  }
  b.then = (resolve, reject) => {
    const has = (op) => record.ops.some(o => o[0] === op)
    const kind = has('upsert') ? 'upsert' : has('insert') ? 'insert' : has('update') ? 'update'
      : has('delete') ? 'delete' : has('maybeSingle') ? 'maybeSingle' : 'select'
    let r
    try {
      r = typeof answer === 'function' ? answer(kind, record) : answer?.[kind]
    } catch (err) {
      return Promise.reject(err).then(resolve, reject)
    }
    return Promise.resolve(r ?? { data: kind === 'maybeSingle' ? null : [], error: null }).then(resolve, reject)
  }
  return b
}
function makeClient(perTable = {}, rpc = null) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => builder(table, perTable[table] ?? (table === 'projects' ? { select: { data: { id: 'p1', title: 'P' }, error: null } } : undefined)),
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpc ? rpc(name, args) : { data: null, error: null } },
  }
}

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const mod = await import('./supabaseAdapter')
const { supabaseAdapter, resetSupabaseAdapter, resetTableViewsSchemaState, COLUMN_ALLOWLIST, TABLE_VIEWS_REFUSALS } = mod
const { viewNameProblem, viewConfigProblem } = await import('../state/tableViewsModel')

const SQL = readFileSync(new URL('../../../../supabase/migrations/0098_table_views.sql', import.meta.url), 'utf8')

const AT = '2026-10-17T09:00:00.123456+00:00'
const VIEW = { id: 'v1', project_id: 'p1', table_key: 'tasks', name: 'Shoot week', position: 0, revision: 7, revised_by: 'u1', config: { version: 1, filters: [] }, created_at: AT, created_by: 'u1', updated_at: AT, updated_by: 'u1' }
const GROUPING = { id: 'g1', project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a1', 'a2'], created_at: AT, created_by: 'u1', updated_at: AT, updated_by: 'u1' }
const MISSING_TABLE = (t) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` })

const tableCalls = (t) => calls.filter(c => c.table === t)
const opsOf = (record, op) => record.ops.filter(o => o[0] === op)
const refusal = (p) => p.then(() => null, (e) => ({ code: e.code, message: e.message }))

// Every view and grouping write, with arguments; the instrument test below
// holds this list to the adapter's own surface.
const WRITES = {
  addTableView: (a) => a.addTableView({ project_id: 'p1', table_key: 'tasks', name: 'X', position: 0, config: {} }),
  updateTableView: (a) => a.updateTableView('v1', { name: 'Y' }, { projectId: 'p1', expectRevision: 7 }),
  deleteTableView: (a) => a.deleteTableView('v1', { projectId: 'p1', expectRevision: 7 }),
  reorderTableViews: (a) => a.reorderTableViews('p1', 'tasks', ['v1']),
  addItemGrouping: (a) => a.addItemGrouping({ project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a1'] }),
  removeItemGrouping: (a) => a.removeItemGrouping('g1', 'p1'),
  setTableViewLast: (a) => a.setTableViewLast('p1:tasks', 'all'),
}

beforeEach(() => {
  calls.length = 0
  resetSupabaseAdapter()
  resetTableViewsSchemaState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  resetTableViewsSchemaState()
  delete globalThis.__testSupabase
  vi.restoreAllMocks()
})

describe('the load and the 0098 probe', () => {
  it('reads both tables in the shared shape and 0098\'s orders, and answers tableViews and itemGroupings', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { select: { data: [VIEW], error: null } }, item_groupings: { select: { data: [GROUPING], error: null } } })
    const a = supabaseAdapter()
    const bundle = await a.loadProject('p1')
    expect(bundle.tableViews).toEqual([VIEW])
    expect(bundle.itemGroupings).toEqual([GROUPING])
    const views = tableCalls('table_views')[0]
    expect(opsOf(views, 'select')[0][1].split(', ')).toEqual(Object.keys(VIEW))
    expect(opsOf(views, 'eq')).toEqual([['eq', 'project_id', 'p1']])
    expect(opsOf(views, 'order').map(o => o[1])).toEqual(['table_key', 'position', 'created_at', 'id'])
    const groupings = tableCalls('item_groupings')[0]
    expect(opsOf(groupings, 'select')[0][1].split(', ')).toEqual(Object.keys(GROUPING))
    expect(opsOf(groupings, 'order').map(o => o[1])).toEqual(['table_key', 'kind', 'created_at', 'id'])
    expect(a.tableViewsAvailable()).toBe(true)
    expect(a.tableViewsLoadError()).toBeNull()
  })

  for (const [code, table] of [['PGRST205', 'table_views'], ['42P01', 'item_groupings']]) {
    it(`${code} on ${table}: both empty, the backend absent, and every write refuses before any request`, async () => {
      const error = code === '42P01' ? { code, message: `relation "public.${table}" does not exist` } : MISSING_TABLE(table)
      globalThis.__testSupabase = makeClient({
        table_views: table === 'table_views' ? { select: { data: null, error } } : { select: { data: [VIEW], error: null } },
        item_groupings: table === 'item_groupings' ? { select: { data: null, error } } : { select: { data: [GROUPING], error: null } },
      })
      const a = supabaseAdapter()
      const bundle = await a.loadProject('p1')
      expect(bundle.project).toEqual({ id: 'p1', title: 'P' })
      expect([bundle.tableViews, bundle.itemGroupings]).toEqual([[], []])
      expect(a.tableViewsAvailable()).toBe(false)
      expect(a.tableViewsLoadError()).toBeNull()
      calls.length = 0
      for (const [name, call] of Object.entries(WRITES)) {
        const err = await refusal(call(a))
        expect(err, name).toEqual({ code: 'table_views_unavailable', message: '[supabase] Saved views and groupings are not on this database yet (migration 0098).' })
      }
      expect(calls).toEqual([])
    })
  }

  it('ANY OTHER error: both empty, the project still opens, and tableViewsLoadError() says it in words; a clean load clears it', async () => {
    globalThis.__testSupabase = makeClient({
      table_views: { select: { data: null, error: { code: '42501', message: 'permission denied for table table_views' } } },
      item_groupings: { select: { data: [GROUPING], error: null } },
      tasks: { select: { data: [{ id: 't1', project_id: 'p1' }], error: null } },
    })
    const a = supabaseAdapter()
    const bundle = await a.loadProject('p1')
    expect(bundle.tasks.map(t => t.id)).toEqual(['t1'])
    expect([bundle.tableViews, bundle.itemGroupings]).toEqual([[], []])
    expect(a.tableViewsLoadError()).toBe('This project\'s saved views and groupings could not be read: permission denied for table table_views.')
    // The other read answered: the tables are there, and the writes go.
    expect(a.tableViewsAvailable()).toBe(true)
    globalThis.__testSupabase = makeClient({ table_views: { select: { data: [VIEW], error: null } } })
    resetSupabaseAdapter()
    const clean = await a.loadProject('p1')
    expect(clean.tableViews).toEqual([VIEW])
    expect(a.tableViewsLoadError()).toBeNull()
  })

  it('a read that throws (the network) is an error in words too, and two failed reads leave the probe\'s mark as it was', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { select: { data: null, error: MISSING_TABLE('table_views') } } })
    const a = supabaseAdapter()
    await a.loadProject('p1')
    expect(a.tableViewsAvailable()).toBe(false)
    const down = () => { throw new TypeError('fetch failed') }
    globalThis.__testSupabase = makeClient({ table_views: down, item_groupings: down })
    resetSupabaseAdapter()
    const bundle = await a.loadProject('p1')
    expect([bundle.tableViews, bundle.itemGroupings]).toEqual([[], []])
    expect(a.tableViewsLoadError()).toBe('This project\'s saved views and groupings could not be read: fetch failed.')
    expect(a.tableViewsAvailable()).toBe(false) // nothing answered: still as the last probe left it
  })

  it('a later load that finds the tables clears the mark (a database migrated mid-session); an auth event does not', async () => {
    globalThis.__testSupabase = makeClient({ item_groupings: { select: { data: null, error: { code: '42P01', message: 'relation "public.item_groupings" does not exist' } } } })
    const a = supabaseAdapter()
    await a.loadProject('p1')
    expect(a.tableViewsAvailable()).toBe(false)
    globalThis.__testSupabase = makeClient()
    resetSupabaseAdapter()
    expect(a.tableViewsAvailable()).toBe(false)
    await a.loadProject('p1')
    expect(a.tableViewsAvailable()).toBe(true)
  })
})

describe('paging: past PostgREST\'s 1,000 rows', () => {
  const paged = (rows, seen) => (kind, record) => {
    const r = opsOf(record, 'range')[0]
    seen.push([r[1], r[2]])
    return { data: rows.slice(r[1], Math.min(r[2] + 1, r[1] + 1000)), error: null }
  }
  it('1,001 views and 1,500 groupings: every one is read, a page at a time, by the load and by the lists', async () => {
    const views = Array.from({ length: 1001 }, (_, i) => ({ ...VIEW, id: `v${String(i).padStart(4, '0')}`, position: i }))
    const groupings = Array.from({ length: 1500 }, (_, i) => ({ ...GROUPING, id: `g${String(i).padStart(4, '0')}`, entity_ids: [`a${i}`] }))
    const seen = { views: [], groupings: [] }
    globalThis.__testSupabase = makeClient({ table_views: paged(views, seen.views), item_groupings: paged(groupings, seen.groupings) })
    const a = supabaseAdapter()
    const bundle = await a.loadProject('p1')
    expect(bundle.tableViews).toHaveLength(1001)
    expect(bundle.itemGroupings).toHaveLength(1500)
    expect(seen.views).toEqual([[0, 999], [1000, 1999]])
    expect(seen.groupings).toEqual([[0, 999], [1000, 1999]])
    expect(await a.listTableViews('p1')).toHaveLength(1001)
    expect(await a.listItemGroupings('p1')).toHaveLength(1500)
  })

  it('the lists are probes too: a missing table answers none and marks the backend; any other error throws', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { select: { data: null, error: MISSING_TABLE('table_views') } } })
    const a = supabaseAdapter()
    expect(await a.listTableViews('p1')).toEqual([])
    expect(a.tableViewsAvailable()).toBe(false)
    globalThis.__testSupabase = makeClient({ item_groupings: { select: { data: [GROUPING], error: null } } })
    resetSupabaseAdapter()
    expect(await a.listItemGroupings('p1')).toEqual([GROUPING])
    expect(a.tableViewsAvailable()).toBe(true)
    globalThis.__testSupabase = makeClient({ item_groupings: { select: { data: null, error: { code: '42501', message: 'permission denied for table item_groupings' } } } })
    resetSupabaseAdapter()
    await expect(a.listItemGroupings('p1')).rejects.toMatchObject({ code: '42501', message: '[supabase] permission denied for table item_groupings' })
  })
})

describe('a view\'s writes', () => {
  it('addTableView is an INSERT (never an upsert) of exactly the granted columns, and answers the stored row', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { insert: { data: VIEW, error: null } } })
    const row = await supabaseAdapter().addTableView({ ...VIEW, workspace_id: 'forged', builtIn: false })
    expect(row).toEqual(VIEW)
    const rec = tableCalls('table_views')[0]
    expect(rec.ops.map(o => o[0])).toEqual(['insert', 'select', 'single'])
    expect(Object.keys(opsOf(rec, 'insert')[0][1]).sort()).toEqual(['config', 'id', 'name', 'position', 'project_id', 'table_key'])
    expect(opsOf(rec, 'select')[0][1]).toBe(Object.keys(VIEW).join(', '))
    // The stamps, the revision and the workspace go silently (the triggers
    // own them); a key that is no column is dropped with the warning.
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn.mock.calls[0][0]).toContain('builtIn')
    expect(console.warn.mock.calls[0][0]).not.toContain('revision')
  })

  it('a new view without an id lets the database make one (no id, null or not, is sent)', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { insert: { data: VIEW, error: null } } })
    await supabaseAdapter().addTableView({ id: null, project_id: 'p1', table_key: 'tasks', name: 'X', position: 0, config: {} })
    expect(opsOf(tableCalls('table_views')[0], 'insert')[0][1]).not.toHaveProperty('id')
  })

  it('the save sends an UPDATE of the changed columns only, filtered on the id and the revision it expects, and answers saved', async () => {
    const saved = { ...VIEW, revision: 8, config: { version: 1, sorts: [] } }
    globalThis.__testSupabase = makeClient({ table_views: { update: { data: [saved], error: null } } })
    const res = await supabaseAdapter().updateTableView('v1', { config: saved.config, revision: 99, id: 'other', project_id: 'p2', table_key: 'shots', workspace_id: 'w' }, { projectId: 'p1', expectRevision: 7 })
    expect(res).toEqual({ status: 'saved', row: saved })
    const rec = tableCalls('table_views')[0]
    expect(opsOf(rec, 'update')[0][1]).toEqual({ config: saved.config })
    expect(opsOf(rec, 'eq')).toEqual([['eq', 'id', 'v1'], ['eq', 'revision', 7]])
    expect(opsOf(rec, 'select')[0][1]).toBe(Object.keys(VIEW).join(', '))
    expect(tableCalls('table_views')).toHaveLength(1) // nothing read when a row came back
  })

  it('a rename\'s undo filters on the name it expects; a write expecting nothing filters on the id alone', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { update: { data: [VIEW], error: null } } })
    const a = supabaseAdapter()
    await a.updateTableView('v1', { name: 'Shoot week' }, { projectId: 'p1', expectName: 'Shoot week (2)' })
    expect(opsOf(tableCalls('table_views')[0], 'eq')).toEqual([['eq', 'id', 'v1'], ['eq', 'name', 'Shoot week (2)']])
    calls.length = 0
    await a.updateTableView('v1', { position: 3 }, { projectId: 'p1' })
    expect(opsOf(tableCalls('table_views')[0], 'eq')).toEqual([['eq', 'id', 'v1']])
    expect(opsOf(tableCalls('table_views')[0], 'update')[0][1]).toEqual({ position: 3 })
  })

  // Design §4.4, as corrected at VW1c's step 0 (finding 13).
  const missed = (now) => makeClient({ table_views: { update: { data: [], error: null }, maybeSingle: now } })
  it('a save that wrote nothing reads the row ONCE: none is deleted', async () => {
    globalThis.__testSupabase = missed({ data: null, error: null })
    expect(await supabaseAdapter().updateTableView('v1', { name: 'Y' }, { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'deleted' })
    const [, read] = tableCalls('table_views')
    expect(read.ops).toEqual([['select', Object.keys(VIEW).join(', ')], ['eq', 'id', 'v1'], ['maybeSingle']])
    expect(tableCalls('table_views')).toHaveLength(2)
  })
  it('another revision is changed (with the row: it names who), another name too, for a rename', async () => {
    const theirs = { ...VIEW, revision: 9, revised_by: 'u2' }
    globalThis.__testSupabase = missed({ data: theirs, error: null })
    expect(await supabaseAdapter().updateTableView('v1', { config: {} }, { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'changed', row: theirs })
    globalThis.__testSupabase = missed({ data: { ...VIEW, name: 'Renamed' }, error: null })
    resetSupabaseAdapter()
    expect(await supabaseAdapter().updateTableView('v1', { name: 'Back' }, { projectId: 'p1', expectName: 'Shoot week' })).toEqual({ status: 'changed', row: { ...VIEW, name: 'Renamed' } })
  })
  it('the same revision is filtered: the access rules filtered the write out without a word', async () => {
    globalThis.__testSupabase = missed({ data: VIEW, error: null })
    expect(await supabaseAdapter().updateTableView('v1', { config: {} }, { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'filtered', row: VIEW })
    // A revision read back as text is the same revision.
    globalThis.__testSupabase = missed({ data: { ...VIEW, revision: '7' }, error: null })
    resetSupabaseAdapter()
    expect((await supabaseAdapter().updateTableView('v1', { config: {} }, { projectId: 'p1', expectRevision: 7 })).status).toBe('filtered')
  })
  it('a read that fails says its own error, never filtered', async () => {
    globalThis.__testSupabase = missed({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    expect(await refusal(supabaseAdapter().updateTableView('v1', { config: {} }, { projectId: 'p1', expectRevision: 7 })))
      .toEqual({ code: '57014', message: '[supabase] canceling statement due to statement timeout' })
  })
  it('a change that names nothing to change is refused before any request', async () => {
    globalThis.__testSupabase = makeClient()
    expect(await refusal(supabaseAdapter().updateTableView('v1', { revision: 9, updated_at: AT }, { projectId: 'p1' })))
      .toEqual({ code: 'invalid', message: TABLE_VIEWS_REFUSALS.nothingToChange })
    expect(calls).toEqual([])
  })

  it('a delete filters on the revision it expects and answers removed; one that removed nothing reads the row once', async () => {
    globalThis.__testSupabase = makeClient({ table_views: { delete: { data: [{ id: 'v1' }], error: null } } })
    const a = supabaseAdapter()
    expect(await a.deleteTableView('v1', { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'removed' })
    const rec = tableCalls('table_views')[0]
    expect(rec.ops).toEqual([['delete'], ['eq', 'id', 'v1'], ['eq', 'revision', 7], ['select', 'id']])
    calls.length = 0
    await a.deleteTableView('v1', { projectId: 'p1' })
    expect(opsOf(tableCalls('table_views')[0], 'eq')).toEqual([['eq', 'id', 'v1']])
    for (const [now, status] of [[null, 'deleted'], [{ ...VIEW, revision: 8 }, 'changed'], [VIEW, 'filtered']]) {
      globalThis.__testSupabase = makeClient({ table_views: { delete: { data: [], error: null }, maybeSingle: { data: now, error: null } } })
      resetSupabaseAdapter()
      const res = await a.deleteTableView('v1', { projectId: 'p1', expectRevision: 7 })
      expect(res, status).toEqual(now ? { status, row: now } : { status })
    }
  })

  it('reorder → reorder_table_views(p_project, p_table_key, p_ids), answering the rows it moved in the shared shape', async () => {
    const moved = [{ ...VIEW, workspace_id: 'w1', position: 1 }]
    globalThis.__testSupabase = makeClient({}, () => ({ data: moved, error: null }))
    const rows = await supabaseAdapter().reorderTableViews('p1', 'tasks', ['v2', 'v1'])
    expect(calls.filter(c => c.rpc)).toEqual([{ rpc: 'reorder_table_views', args: { p_project: 'p1', p_table_key: 'tasks', p_ids: ['v2', 'v1'] } }])
    expect(rows).toEqual([{ ...VIEW, position: 1 }])
  })

  it('reorder: a missing function is the feature missing (and remembered); its 22023 keeps the function\'s words', async () => {
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reorder_table_views(p_ids, p_project, p_table_key) in the schema cache' } }))
    const a = supabaseAdapter()
    expect(await refusal(a.reorderTableViews('p1', 'tasks', ['v1']))).toMatchObject({ code: 'table_views_unavailable' })
    expect(a.tableViewsAvailable()).toBe(false)
    resetTableViewsSchemaState()
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: '22023', message: 'reorder_table_views: a view is named twice' } }))
    resetSupabaseAdapter()
    expect(await refusal(a.reorderTableViews('p1', 'tasks', ['v1', 'v1']))).toEqual({ code: '22023', message: '[supabase] reorder_table_views: a view is named twice' })
    expect(a.tableViewsAvailable()).toBe(true)
  })
})

describe('a grouping\'s writes', () => {
  it('addItemGrouping is an INSERT of exactly the granted columns, and answers the stored row', async () => {
    globalThis.__testSupabase = makeClient({ item_groupings: { insert: { data: GROUPING, error: null } } })
    const row = await supabaseAdapter().addItemGrouping({ ...GROUPING, workspace_id: 'forged', updated_at: AT })
    expect(row).toEqual(GROUPING)
    const rec = tableCalls('item_groupings')[0]
    expect(rec.ops.map(o => o[0])).toEqual(['insert', 'select', 'single'])
    expect(Object.keys(opsOf(rec, 'insert')[0][1]).sort()).toEqual(['entity_ids', 'id', 'kind', 'project_id', 'table_key'])
    expect(opsOf(rec, 'select')[0][1]).toBe(Object.keys(GROUPING).join(', '))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('a set already stored for that table and kind (23505) answers the stored row, read by the set whatever its order', async () => {
    const theirs = { ...GROUPING, id: 'theirs' }
    globalThis.__testSupabase = makeClient({ item_groupings: {
      insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "item_groupings_set_key"' } },
      maybeSingle: { data: theirs, error: null },
    } })
    expect(await supabaseAdapter().addItemGrouping({ id: 'mine', project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a2', 'a1', 'a2'] })).toEqual(theirs)
    const read = tableCalls('item_groupings')[1]
    expect(opsOf(read, 'eq')).toEqual([['eq', 'project_id', 'p1'], ['eq', 'table_key', 'tasks'], ['eq', 'kind', 'asset']])
    expect(opsOf(read, 'contains')).toEqual([['contains', 'entity_ids', ['a1', 'a2']]])
    expect(opsOf(read, 'containedBy')).toEqual([['containedBy', 'entity_ids', ['a1', 'a2']]])
    expect(opsOf(read, 'maybeSingle')).toHaveLength(1)
  })

  it('a duplicate key whose set is not stored (an id another set holds) is refused, its SQLSTATE kept', async () => {
    globalThis.__testSupabase = makeClient({ item_groupings: {
      insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "item_groupings_pkey"' } },
      maybeSingle: { data: null, error: null },
    } })
    expect(await refusal(supabaseAdapter().addItemGrouping(GROUPING)))
      .toEqual({ code: '23505', message: '[supabase] duplicate key value violates unique constraint "item_groupings_pkey"' })
  })

  it('removeItemGrouping deletes by id and answers { removed }; nothing removed is read once: gone, or filtered out (review round 1, R1-3)', async () => {
    globalThis.__testSupabase = makeClient({ item_groupings: { delete: { data: [{ id: 'g1' }], error: null } } })
    const a = supabaseAdapter()
    expect(await a.removeItemGrouping('g1', 'p1')).toEqual({ removed: true })
    expect(tableCalls('item_groupings')[0].ops).toEqual([['delete'], ['eq', 'id', 'g1'], ['select', 'id']])
    expect(tableCalls('item_groupings')).toHaveLength(1) // removed: no read-back
    // Gone: the read finds no row.
    calls.length = 0
    globalThis.__testSupabase = makeClient({ item_groupings: { delete: { data: [], error: null } } })
    resetSupabaseAdapter()
    expect(await a.removeItemGrouping('g1', 'p1')).toEqual({ removed: false, status: 'deleted' })
    expect(tableCalls('item_groupings')[1].ops).toEqual([['select', 'id'], ['eq', 'id', 'g1'], ['maybeSingle']])
    // Still there: the policies filtered the delete out (the person may no longer change groupings).
    globalThis.__testSupabase = makeClient({ item_groupings: { delete: { data: [], error: null }, maybeSingle: { data: { id: 'g1' }, error: null } } })
    resetSupabaseAdapter()
    expect(await a.removeItemGrouping('g1', 'p1')).toEqual({ removed: false, status: 'filtered' })
  })

  it('the instrument: WRITES is every view and grouping write the adapter has', () => {
    globalThis.__testSupabase = makeClient()
    const a = supabaseAdapter()
    const writes = Object.keys(a).filter(k => /TableView|ItemGrouping/.test(k) && !/^(list|get)|Available$|LoadError$/.test(k)).sort()
    expect(writes).toEqual(Object.keys(WRITES).sort())
  })
})

describe('refusals in words, the SQLSTATE kept', () => {
  const refusing = (table, error) => makeClient({ [table]: { insert: { data: null, error }, update: { data: null, error } } })
  const view = { project_id: 'p1', table_key: 'tasks', name: 'Shoot week', position: 0, config: { version: 1 } }
  const grouping = { project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a1'] }
  const check = (t, c) => ({ code: '23514', message: `new row for relation "${t}" violates check constraint "${c}"` })

  it('42501: the person may no longer change views — or groupings — on this project', async () => {
    const rls = (t) => ({ code: '42501', message: `new row violates row-level security policy for table "${t}"` })
    globalThis.__testSupabase = refusing('table_views', rls('table_views'))
    expect(await refusal(supabaseAdapter().addTableView(view))).toEqual({ code: '42501', message: 'You can no longer change views on this project.' })
    globalThis.__testSupabase = refusing('item_groupings', rls('item_groupings'))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addItemGrouping(grouping))).toEqual({ code: '42501', message: TABLE_VIEWS_REFUSALS.groupingGate })
  })

  it('23514: each CHECK in the model\'s words for what was sent', async () => {
    const cases = [
      ['table_views_name_chk', { ...view, name: 'Padded ' }, viewNameProblem('Padded ')],
      ['table_views_config_chk', { ...view, config: [] }, viewConfigProblem([])],
      ['table_views_position_chk', { ...view, position: -1 }, TABLE_VIEWS_REFUSALS.position],
      ['table_views_table_key_chk', { ...view, table_key: 'budget' }, TABLE_VIEWS_REFUSALS.tableKey],
    ]
    for (const [constraint, sent, words] of cases) {
      globalThis.__testSupabase = refusing('table_views', check('table_views', constraint))
      resetSupabaseAdapter()
      expect(await refusal(supabaseAdapter().addTableView(sent)), constraint).toEqual({ code: '23514', message: words })
    }
    // A save's CHECK reads the columns it sent.
    globalThis.__testSupabase = refusing('table_views', check('table_views', 'table_views_name_chk'))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().updateTableView('v1', { name: 'a\tb' }, { projectId: 'p1', expectRevision: 7 })))
      .toEqual({ code: '23514', message: viewNameProblem('a\tb') })
    globalThis.__testSupabase = refusing('item_groupings', check('item_groupings', 'item_groupings_pair_chk'))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addItemGrouping({ ...grouping, table_key: 'scenes' }))).toEqual({ code: '23514', message: 'The scenes table cannot be grouped by asset.' })
    globalThis.__testSupabase = refusing('item_groupings', check('item_groupings', 'item_groupings_ids_chk'))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addItemGrouping({ ...grouping, entity_ids: [] }))).toEqual({ code: '23514', message: 'A grouping names at least one item.' })
    // CONTROL: a CHECK it does not know keeps Postgres' words.
    globalThis.__testSupabase = refusing('table_views', check('table_views', 'some_later_chk'))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addTableView(view))).toEqual({ code: '23514', message: '[supabase] new row for relation "table_views" violates check constraint "some_later_chk"' })
  })

  it('54000 (the caps) and 23503 (the ids\' check) are the database\'s own words; a foreign key\'s 23503 keeps the prefix', async () => {
    const cap = 'A project\'s Tasks table holds at most 200 saved views.'
    globalThis.__testSupabase = refusing('table_views', { code: '54000', message: cap })
    expect(await refusal(supabaseAdapter().addTableView(view))).toEqual({ code: '54000', message: cap })
    const notHere = 'A grouping can name only this project\'s own assets: 1 of the 1 named are not in it (or are in the trash).'
    globalThis.__testSupabase = refusing('item_groupings', { code: '23503', message: notHere })
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addItemGrouping(grouping))).toEqual({ code: '23503', message: notHere })
    const fk = 'insert or update on table "item_groupings" violates foreign key constraint "item_groupings_project_fk"'
    globalThis.__testSupabase = refusing('item_groupings', { code: '23503', message: fk })
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().addItemGrouping(grouping))).toEqual({ code: '23503', message: `[supabase] ${fk}` })
  })

  it('anything else keeps Postgres\' words after the prefix; a write that meets a missing table marks the backend absent', async () => {
    globalThis.__testSupabase = refusing('table_views', { code: '22P02', message: 'invalid input syntax for type integer: "1.5"' })
    expect(await refusal(supabaseAdapter().addTableView({ ...view, position: 1.5 }))).toEqual({ code: '22P02', message: '[supabase] invalid input syntax for type integer: "1.5"' })
    globalThis.__testSupabase = refusing('table_views', MISSING_TABLE('table_views'))
    resetSupabaseAdapter()
    const a = supabaseAdapter()
    expect(await refusal(a.addTableView(view))).toMatchObject({ code: 'table_views_unavailable' })
    expect(a.tableViewsAvailable()).toBe(false)
    // A 42P01 from inside the statement (a trigger's query) is not 0098 missing.
    resetTableViewsSchemaState()
    globalThis.__testSupabase = refusing('table_views', { code: '42P01', message: 'relation "public.some_helper" does not exist' })
    resetSupabaseAdapter()
    expect(await refusal(a.addTableView(view))).toMatchObject({ code: '42P01' })
    expect(a.tableViewsAvailable()).toBe(true)
  })
})

describe('the last used view (Q4): user_settings.table_view_last', () => {
  it('getTableViewLast reads the one column by its own request; no row yet is an empty map, available', async () => {
    globalThis.__testSupabase = makeClient({ user_settings: { maybeSingle: { data: null, error: null } } })
    const a = supabaseAdapter()
    expect(await a.getTableViewLast()).toEqual({ available: true, map: {} })
    expect(tableCalls('user_settings')[0].ops).toEqual([['select', 'table_view_last'], ['maybeSingle']])
    const map = { 'p1:tasks': { view: 'v1', at: 1 } }
    globalThis.__testSupabase = makeClient({ user_settings: { maybeSingle: { data: { table_view_last: map }, error: null } } })
    resetSupabaseAdapter()
    expect(await a.getTableViewLast()).toEqual({ available: true, map })
  })

  it('its read is its own probe: 42703 / PGRST204 is not on this server (an empty map); any other error throws', async () => {
    for (const code of ['42703', 'PGRST204']) {
      globalThis.__testSupabase = makeClient({ user_settings: { maybeSingle: { data: null, error: { code, message: 'column user_settings.table_view_last does not exist' } } } })
      resetSupabaseAdapter()
      expect(await supabaseAdapter().getTableViewLast(), code).toEqual({ available: false, map: {} })
    }
    globalThis.__testSupabase = makeClient({ user_settings: { maybeSingle: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } } })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().getTableViewLast()).rejects.toMatchObject({ code: '57014', message: '[supabase] canceling statement due to statement timeout' })
  })

  it('setTableViewLast → set_table_view_last(p_key, p_view), answering the map', async () => {
    const map = { 'p1:tasks': { view: 'all', at: 1760000000000 } }
    globalThis.__testSupabase = makeClient({}, () => ({ data: map, error: null }))
    expect(await supabaseAdapter().setTableViewLast('p1:tasks', 'all')).toEqual(map)
    expect(calls.filter(c => c.rpc)).toEqual([{ rpc: 'set_table_view_last', args: { p_key: 'p1:tasks', p_view: 'all' } }])
  })

  it('a missing function is the feature missing (code table_views_unavailable); a key or view it refuses keeps its 22023 and words', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.set_table_view_last(p_key, p_view) in the schema cache' },
      { code: '42883', message: 'function public.set_table_view_last(text, text) does not exist' },
    ]) {
      globalThis.__testSupabase = makeClient({}, () => ({ data: null, error }))
      resetSupabaseAdapter()
      expect(await refusal(supabaseAdapter().setTableViewLast('p1:tasks', 'all')), error.code).toMatchObject({ code: 'table_views_unavailable' })
    }
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: '42883', message: 'function public.jsonb_some_helper(jsonb) does not exist' } }))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().setTableViewLast('p1:tasks', 'all'))).toMatchObject({ code: '42883' })
    const words = 'set_table_view_last: p1:budget is not a project id and a table (tasks, assets, scenes, shots, levels, experiences)'
    globalThis.__testSupabase = makeClient({}, () => ({ data: null, error: { code: '22023', message: words } }))
    resetSupabaseAdapter()
    expect(await refusal(supabaseAdapter().setTableViewLast('p1:budget', 'all'))).toEqual({ code: '22023', message: `[supabase] ${words}` })
  })
})

describe('held to the migration: the allowlist, the columns read, the parameter names sent', () => {
  it('the allowlist is exactly the column grants — never workspace_id, a revision or a stamp', () => {
    expect([...COLUMN_ALLOWLIST.table_views].sort()).toEqual(['config', 'id', 'name', 'position', 'project_id', 'table_key'])
    expect([...COLUMN_ALLOWLIST.item_groupings].sort()).toEqual(['entity_ids', 'id', 'kind', 'project_id', 'table_key'])
  })

  // Every column a read names must be one 0098 declares: one that is not
  // would answer 42703 — on the load, an error state; on a write, a refusal.
  function declaredColumns(table) {
    const m = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\s*CONSTRAINT`).exec(SQL)
    if (!m) throw new Error(`0098 creates no ${table}`)
    return m[1].split('\n').map(l => l.trim().split(/\s+/)[0]).filter(w => /^[a-z_]+$/.test(w))
  }
  it('every column the reads and writes name is one 0098 declares (and workspace_id is not read)', async () => {
    globalThis.__testSupabase = makeClient()
    await supabaseAdapter().loadProject('p1')
    for (const table of ['table_views', 'item_groupings']) {
      const named = opsOf(tableCalls(table)[0], 'select')[0][1].split(', ')
      const declared = declaredColumns(table)
      expect(named.filter(c => !declared.includes(c)), table).toEqual([])
      expect(named, table).not.toContain('workspace_id')
      for (const c of COLUMN_ALLOWLIST[table]) expect(declared, `${table}.${c}`).toContain(c)
    }
  })
  it('CONTROL: the migration is read for real', () => {
    expect(() => declaredColumns('no_such_table')).toThrow(/creates no/)
    expect(declaredColumns('table_views')).toEqual(['id', 'project_id', 'workspace_id', 'table_key', 'name', 'position', 'revision', 'revised_by', 'config', 'created_at', 'created_by', 'updated_at', 'updated_by'])
  })

  // PGRST202 is also PostgREST's answer to a parameter-NAME mismatch, which
  // this adapter reads as "0098 is not here": the names are held to the file.
  function declared(name) {
    const m = SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(([^)]*)\\)`))
    if (!m) throw new Error(`0098 declares no function ${name}`)
    return m[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean).sort()
  }
  const RPCS = {
    reorder_table_views: (a) => a.reorderTableViews('p1', 'tasks', ['v1']),
    set_table_view_last: (a) => a.setTableViewLast('p1:tasks', 'all'),
  }
  for (const [fn, call] of Object.entries(RPCS)) {
    it(`${fn}: the parameter names sent are the ones 0098 declares`, async () => {
      globalThis.__testSupabase = makeClient({}, () => ({ data: fn === 'set_table_view_last' ? {} : [], error: null }))
      await call(supabaseAdapter())
      const sent = calls.find(c => c.rpc === fn)
      expect(sent, `${fn} was not called`).toBeTruthy()
      expect(Object.keys(sent.args).sort()).toStrictEqual(declared(fn))
    })
  }
  it('CONTROL: a function 0098 does not declare is reported, and the declared list is exact', () => {
    expect(() => declared('no_such_function')).toThrow(/declares no function/)
    expect(declared('reorder_table_views')).toStrictEqual(['p_ids', 'p_project', 'p_table_key'])
  })
})
