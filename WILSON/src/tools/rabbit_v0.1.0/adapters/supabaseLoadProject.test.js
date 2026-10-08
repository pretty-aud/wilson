// =============================================================================
// supabaseLoadProject.test.js — Session 25.
//
// loadProject returns an EXPLICIT list of named keys, and the provider does
// `setBundle({ ...EMPTY_BUNDLE, ...next })`. A key the adapter omits is
// therefore not merely missing — it is RESET TO THE EMPTY ARRAY on every
// project load, switch and realtime refetch.
//
// That class of bug has now shipped TWICE:
//   * S17 — milestones vanished on every reload (loadProjectBundle.test.js
//     covers the LOCAL adapter for exactly this reason).
//   * S24 — ctx.budgetVersions was permanently empty in cloud regardless of
//     what the database held, because the cloud loadProject omitted the key.
//
// loadProjectBundle.test.js only ever covered localServerAdapter. The cloud
// adapter — the one the beta actually runs — had no such guard, which is why
// the S24 instance was found by reading rather than by a failing test. S25
// adds four more keys to it (scenes/shots/levels/experiences), so this closes
// that gap before it can happen a third time.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// A chainable query builder. Every PostgREST method loadProject uses returns
// `this`, and the builder itself is thenable, so `.select().eq().order()` and
// a bare `.select()` both resolve to the same { data, error }.
function builder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    // S4c: scenes and shots are read page by page (readAllPages); one page
    // of fewer than 1,000 rows is the whole list here.
    range: () => b,
    single: () => b,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return b
}

/** Per-table results; anything unnamed resolves to an empty list. */
function makeClient(perTable = {}) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => builder(
      table in perTable ? perTable[table] : { data: [], error: null },
    ),
  }
}

let client
vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  get supabase() { return globalThis.__testSupabase },
}))

const { supabaseAdapter, resetSupabaseAdapter, resetShotListSchemaState } = await import('./supabaseAdapter')
const { googleDriveAdapter } = await import('./googleDriveAdapter')

// resetSupabaseAdapter no longer forgets what a load learned about 0084 (S3a
// review R1, cloud#0 — auth events call it), so every test forgets it here
// with the test-only reset, or a "0084 absent" load would leak into the next.
beforeEach(() => {
  client = makeClient({
    projects: { data: { id: 'p1', title: 'Project One' }, error: null },
  })
  globalThis.__testSupabase = client
  resetSupabaseAdapter()
  resetShotListSchemaState()
})

afterEach(() => {
  resetSupabaseAdapter()
  resetShotListSchemaState()
  delete globalThis.__testSupabase
  vi.restoreAllMocks()
})


// Mirror of the collection keys the cloud loadProject is responsible for.
// Deliberately NOT the whole of EMPTY_BUNDLE: managedFiles and projectTeam are
// local-server concepts, and budgetLines/budgetActuals are owned by the
// useBudgetLines hook rather than the bundle. Those exclusions are decisions,
// and the same ones loadProjectBundle.test.js documents for its own list.
const CLOUD_BUNDLE_KEYS = [
  'phases', 'assets', 'tasks', 'dependencies', 'taskLinks', 'files',
  'assetVersions', 'comments', 'ingestionRuns', 'budgetVersions', 'expenses',
  'teamAssignments',
  'scenes', 'shots', 'levels', 'experiences',
  'folders',
  // 0067. The key with the proven cost: S17 found the LOCAL adapter
  // omitting it and every milestone being reset to [] on each load — real
  // data loss, found by reading. The cloud adapter could not omit it
  // before now only because its two milestone methods threw outright.
  'milestones',
  // 0084 (post-overhaul S3a). ctx.scenes / ctx.shots read the ACTIVE list
  // (D10), so an omitted shotLists would not merely empty a picker — the
  // active list would vanish on every load and every surface would fall back
  // to "every scene and shot".
  'shotLists', 'shotListItems', 'edits',
  // 0090 (post-overhaul S5b): the set-aside rows, split out by the loader.
  'setAsideTasks', 'setAsidePhases', 'setAsideMilestones', 'setAsideDependencies',
  // 0091 (BC1): bins, bin files, takes and the company's locations ride the
  // load; binRoots is answered [] (the signed-out desktop's known roots have
  // no cloud shape). An omitted key would reset the Bins tab on every load.
  'bins', 'binFiles', 'binRoots', 'shotTakes', 'binLocations',
]

describe('supabaseAdapter.loadProject — bundle key coverage', () => {
  it('returns every collection key, so none is reset to [] by the provider', async () => {
    const bundle = await supabaseAdapter().loadProject('p1')
    const missing = CLOUD_BUNDLE_KEYS.filter(k => bundle[k] === undefined)
    expect(missing).toEqual([])
  })

  it('carries the four 0040 entities through with their rows', async () => {
    globalThis.__testSupabase = makeClient({
      projects:    { data: { id: 'p1', title: 'Project One' }, error: null },
      scenes:      { data: [{ id: 'sc1', name: 'WLSN_SC001' }], error: null },
      shots:       { data: [{ id: 'sh1', scene_id: 'sc1' }], error: null },
      levels:      { data: [{ id: 'lv1' }], error: null },
      experiences: { data: [{ id: 'ex1' }], error: null },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.scenes).toEqual([{ id: 'sc1', name: 'WLSN_SC001' }])
    expect(bundle.shots).toEqual([{ id: 'sh1', scene_id: 'sc1' }])
    expect(bundle.levels).toEqual([{ id: 'lv1' }])
    expect(bundle.experiences).toEqual([{ id: 'ex1' }])
  })
})

describe('the folder tree rides the same load (Session 26, 0041)', () => {
  it('carries folders through with their rows', async () => {
    globalThis.__testSupabase = makeClient({
      projects: { data: { id: 'p1', title: 'Project One' }, error: null },
      folders:  { data: [
        { id: 'f1', kind: 'root',     path: '' },
        { id: 'f2', kind: 'category', path: 'SCENES' },
      ], error: null },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.folders).toHaveLength(2)
    expect(bundle.folders[0].path).toBe('')
  })

  it('degrades to an empty tree on a client deployed ahead of 0041', async () => {
    // Same reasoning as the 0040 block below: `feat/multi-user-v1`
    // auto-deploys the staging-backed beta on push, so a client can reach a
    // database without public.folders. No folder tree must not become no
    // project.
    globalThis.__testSupabase = makeClient({
      projects: { data: { id: 'p1', title: 'Project One' }, error: null },
      folders:  { data: null, error: { code: '42P01', message: 'relation "public.folders" does not exist' } },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
    expect(bundle.folders).toEqual([])
  })
})

// ── Dependencies: two tables, one collection (0061) ─────────────────────────

describe('loadProject unions both dependency tables', () => {
  const TASK_EDGE  = { id: 'td1', predecessor_id: 't1', successor_id: 't2', type: 'FS', lag_days: 0 }
  const PHASE_EDGE = { id: 'pd1', predecessor_id: 'ph1', successor_id: 'ph2', type: 'FS', lag_days: 0 }

  function clientWith(deps) {
    return makeClient({
      projects: { data: { id: 'p1', title: 'Project One' }, error: null },
      ...deps,
    })
  }

  it('returns both kinds in one collection, each stamped from its table', () => {
    // `kind` is NOT a column on either table — it is implied by which table the
    // row came from. DetailPane.visibleDeps routes the arrow by `d.kind ||
    // 'task'`, so an unstamped phase edge is looked up in rowIndexByTaskId,
    // misses, and draws nothing.
    globalThis.__testSupabase = clientWith({
      task_dependencies:  { data: [TASK_EDGE],  error: null },
      phase_dependencies: { data: [PHASE_EDGE], error: null },
    })
    resetSupabaseAdapter()

    return supabaseAdapter().loadProject('p1').then(bundle => {
      expect(bundle.dependencies).toHaveLength(2)
      expect(bundle.dependencies.find(d => d.id === 'td1').kind).toBe('task')
      expect(bundle.dependencies.find(d => d.id === 'pd1').kind).toBe('phase')
    })
  })

  it('strips the `predecessor` embed — the undo-after-reload bug', async () => {
    // 🚨 The select carries `predecessor:tasks!..._fkey(project_id)`, so every
    // loaded row arrives with a `predecessor` object that is not a column.
    // RabbitProvider's undo path re-sends the loaded row verbatim via
    // upsertDependency(oldRow), so leaving it on meant undo-of-unlink PGRST204'd
    // on any dependency the user had not created in that same session — a
    // failure that looks intermittent because it depends on whether the page
    // had been reloaded.
    globalThis.__testSupabase = clientWith({
      task_dependencies: {
        data: [{ ...TASK_EDGE, predecessor: { project_id: 'p1' } }],
        error: null,
      },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.dependencies[0]).not.toHaveProperty('predecessor')
    expect(bundle.dependencies[0].id).toBe('td1')
  })

  it('degrades to task edges only on a client deployed ahead of 0061', async () => {
    // The beta auto-deploys on push; 0061 is applied by hand. In that window
    // phase_dependencies does not exist, and "no phase edges yet" is true.
    // Losing the TASK edges as well would be the actual regression.
    globalThis.__testSupabase = clientWith({
      task_dependencies:  { data: [TASK_EDGE], error: null },
      phase_dependencies: { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.phase_dependencies' in the schema cache" } },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.dependencies).toHaveLength(1)
    expect(bundle.dependencies[0].kind).toBe('task')
  })

  it('does NOT swallow a genuine phase_dependencies error as an empty list', async () => {
    // The failing control for the test above. unwrapOptionalTable absorbs only
    // 42P01/PGRST205; an RLS refusal must not be indistinguishable from "this
    // project has no phase edges". A trailing `.catch(() => [])` on that query
    // would make this test fail — which is exactly why it is here.
    globalThis.__testSupabase = clientWith({
      phase_dependencies: { data: null, error: { code: '42501', message: 'permission denied for table phase_dependencies' } },
    })
    resetSupabaseAdapter()

    await expect(supabaseAdapter().loadProject('p1'))
      .rejects.toThrow(/permission denied/)
  })
})

describe('a client deployed ahead of migration 0040', () => {
  // `feat/multi-user-v1` auto-deploys the STAGING-backed beta on push, so the
  // client can legitimately reach a database without 0040. The four entity
  // lists must degrade to empty rather than taking the whole project load
  // down — a missing feature must not become a total outage.
  const MISSING_TABLE = { data: null, error: { code: '42P01', message: 'relation "public.scenes" does not exist' } }

  it('still loads the project, with the entities empty', async () => {
    globalThis.__testSupabase = makeClient({
      projects:    { data: { id: 'p1', title: 'Project One' }, error: null },
      scenes:      MISSING_TABLE,
      shots:       MISSING_TABLE,
      levels:      MISSING_TABLE,
      experiences: MISSING_TABLE,
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
    expect(bundle.scenes).toEqual([])
    expect(bundle.shots).toEqual([])
  })

  it('does NOT swallow a genuine error the same way', async () => {
    // The distinction useRosterMembers gets wrong: a broken read and an empty
    // one must not look identical. Only "relation does not exist" is absorbed.
    globalThis.__testSupabase = makeClient({
      projects: { data: { id: 'p1' }, error: null },
      scenes:   { data: null, error: { code: '42501', message: 'permission denied for table scenes' } },
    })
    resetSupabaseAdapter()

    await expect(supabaseAdapter().loadProject('p1'))
      .rejects.toThrow(/permission denied/)
  })
})


// ── Milestones (0067, rulings 26 and 38) ────────────────────────────────────

describe('milestones ride the same load', () => {
  it('carries milestones through with their rows', async () => {
    globalThis.__testSupabase = makeClient({
      projects:   { data: { id: 'p1', title: 'Project One' }, error: null },
      milestones: { data: [
        { id: 'm1', title: 'Lock picture', date: '2026-10-01', phase_id: null },
        { id: 'm2', title: 'Delivery',     date: '2026-11-15', phase_id: 'ph1' },
      ], error: null },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.milestones).toHaveLength(2)
    expect(bundle.milestones[0].title).toBe('Lock picture')
    // An unparented milestone survives the load. 0067's SELECT policy hops to
    // the project, never the phase, so this is a real row and not an artefact
    // of the stub — see pgTAP 71 probes 8-9 for the database half.
    expect(bundle.milestones[0].phase_id).toBeNull()
  })

  it('degrades to an empty list on a client deployed ahead of 0067', async () => {
    // `feat/multi-user-v1` auto-deploys the staging-backed beta on push, so a
    // client can reach a database without public.milestones. No key dates must
    // not become no project — the same contract folders and the 0040 entities
    // have.
    globalThis.__testSupabase = makeClient({
      projects:   { data: { id: 'p1', title: 'Project One' }, error: null },
      milestones: { data: null, error: { code: '42P01', message: 'relation "public.milestones" does not exist' } },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
    expect(bundle.milestones).toEqual([])
  })

  it('a real error is NOT swallowed — only a missing table is', async () => {
    // unwrapOptionalTable absorbs 42P01/PGRST205 and nothing else. A
    // permission failure or a network fault must still fail the load rather
    // than quietly drawing a timeline with no key dates on it.
    globalThis.__testSupabase = makeClient({
      projects:   { data: { id: 'p1', title: 'Project One' }, error: null },
      milestones: { data: null, error: { code: '42501', message: 'permission denied for table milestones' } },
    })
    resetSupabaseAdapter()

    await expect(supabaseAdapter().loadProject('p1')).rejects.toThrow(/permission denied/)
  })
})


// ── R1 corrections (A2 session 2) ───────────────────────────────────────────

describe('listTrashedMilestones degrades on a MISSING FUNCTION, not a missing table', () => {
  function clientWithRpc(result) {
    const c = makeClient({ projects: { data: { id: 'p1' }, error: null } })
    c.rpc = async () => result
    return c
  }

  it('absorbs PGRST202 — the code PostgREST returns for a missing function', async () => {
    // R1: the first version ran the RPC through unwrapOptionalTable, which
    // absorbs 42P01/PGRST205 — a missing RELATION. An RPC against a client
    // deployed ahead of 0067 answers PGRST202, so the panel threw where its
    // own comment promised an empty trash.
    globalThis.__testSupabase = clientWithRpc({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.milestones_trash_index' },
    })
    resetSupabaseAdapter()
    expect(await supabaseAdapter().listTrashedMilestones('p1')).toEqual([])
  })

  it('absorbs 42883, the Postgres-side undefined_function', async () => {
    globalThis.__testSupabase = clientWithRpc({
      // The message must NAME the function: 42883 raised INSIDE the function's
      // body (a helper dropped) is a real failure and must not be absorbed.
      data: null,
      error: { code: '42883', message: 'function public.milestones_trash_index(uuid) does not exist' },
    })
    resetSupabaseAdapter()
    expect(await supabaseAdapter().listTrashedMilestones('p1')).toEqual([])
  })

  it('does NOT absorb a 42883 raised INSIDE the function body', async () => {
    // PostgREST surfaces the Postgres code, so a helper that was dropped or
    // re-signatured inside milestones_trash_index arrives as 42883 too. Turning
    // that into an empty trash is the exact "could not look vs nothing here"
    // conflation this method claims to avoid (R2).
    globalThis.__testSupabase = clientWithRpc({
      data: null,
      error: { code: '42883', message: 'function public.current_workspace_id() does not exist' },
    })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().listTrashedMilestones('p1')).rejects.toThrow(/current_workspace_id/)
  })

  it('does NOT absorb a permission failure — "could not look" must reach the panel', async () => {
    globalThis.__testSupabase = clientWithRpc({
      data: null, error: { code: '42501', message: 'permission denied' },
    })
    resetSupabaseAdapter()
    await expect(supabaseAdapter().listTrashedMilestones('p1')).rejects.toThrow(/permission denied/)
  })

  // ── The adapter's own health bookkeeping ────────────────────────────────
  //
  // A SOURCE PIN, and it says so. `lastError` / `lastSyncAt` are module-scope
  // and not exported; `status()` cannot witness them because its ordinary arm
  // RE-PROBES the database and overwrites lastError with its own result, and
  // its no-client arm is only reachable through `resetSupabaseAdapter()`,
  // which clears lastError as its first act. So there is no behavioural
  // vantage point, and a pin is the honest instrument that remains.
  //
  // What it guards: R2 found this method — the file's single hand-rolled error
  // block — skipping the bookkeeping every other path does, so a failing trash
  // read left the adapter reporting stale health.
  it('records lastError and lastSyncAt like every other path in the file', () => {
    const SRC = readFileSync(
      new URL('./supabaseAdapter.js', import.meta.url), 'utf-8')
    const start = SRC.indexOf('async listTrashedMilestones(projectId)')
    expect(start, 'listTrashedMilestones moved or was renamed').toBeGreaterThan(-1)
    // To the NEXT method declaration, so the slice is the whole body and
    // nothing after it.
    const NEXT = String.fromCharCode(10) + '    async '
    const next = SRC.indexOf(NEXT, start + 1)
    const body = SRC.slice(start, next > start ? next : start + 4000)
    // The failure path records the message...
    expect(body).toContain('lastError = msg')
    // ...and the success path clears it and stamps the sync time.
    expect(body).toContain('lastError  = null')
    expect(body).toContain('lastSyncAt = new Date()')
  })

  it('returns the rows when the function is there', async () => {
    globalThis.__testSupabase = clientWithRpc({
      data: [{ id: 'm1', title: 'Wrap', deleted_at: '2026-09-07T00:00:00Z' }], error: null,
    })
    resetSupabaseAdapter()
    expect(await supabaseAdapter().listTrashedMilestones('p1')).toHaveLength(1)
  })
})

describe('destroyMilestone is a HARD delete, deleteMilestone is not', () => {
  it('destroyMilestone deletes the row; deleteMilestone calls the trash RPC', async () => {
    // The two must not converge: undoing a CREATE has to leave no trash entry,
    // while deleting a key date the user made has to be recoverable.
    const seen = { deleted: null, rpc: null }
    const c = makeClient({ projects: { data: { id: 'p1' }, error: null } })
    c.from = () => {
      const b = {
        delete: () => { seen.deleted = 'delete'; return b },
        eq: () => b,
        then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
      }
      return b
    }
    c.rpc = async (name, args) => { seen.rpc = { name, args }; return { data: true, error: null } }
    globalThis.__testSupabase = c
    resetSupabaseAdapter()

    await supabaseAdapter().destroyMilestone('m1', 'p1')
    expect(seen.deleted).toBe('delete')
    expect(seen.rpc).toBeNull()

    await supabaseAdapter().deleteMilestone('m2', 'p1')
    expect(seen.rpc).toEqual({ name: 'soft_delete_row', args: { p_table: 'milestones', p_id: 'm2' } })
  })
})


// ── Shot lists, items and edits (0084, post-overhaul S3a) ───────────────────

const PROJECT_ROW = { data: { id: 'p1', title: 'Project One' }, error: null }
const MISSING_42P01 = (t) => ({ data: null, error: { code: '42P01', message: `relation "public.${t}" does not exist` } })
const MISSING_PGRST205 = (t) => ({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } })
const SHOT_TABLES = { shot_lists: 'shotLists', shot_list_items: 'shotListItems', edits: 'edits' }

describe('shot lists ride the same load (0084)', () => {
  it('carries the three collections through with their rows', async () => {
    globalThis.__testSupabase = makeClient({
      projects:        PROJECT_ROW,
      shot_lists:      { data: [{ id: 'l1', title: 'Shot list 1', version: 1 }], error: null },
      shot_list_items: { data: [{ id: 'i1', shot_list_id: 'l1', scene_id: 'sc1', position: 0 }], error: null },
      edits:           { data: [{ id: 'e1', shot_list_id: 'l1', items: [] }], error: null },
    })
    resetSupabaseAdapter()

    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.shotLists).toEqual([{ id: 'l1', title: 'Shot list 1', version: 1 }])
    expect(bundle.shotListItems).toEqual([{ id: 'i1', shot_list_id: 'l1', scene_id: 'sc1', position: 0 }])
    expect(bundle.edits).toEqual([{ id: 'e1', shot_list_id: 'l1', items: [] }])
  })

  it('asks for the contract order: lists and edits by created_at then id, items by position then id', async () => {
    // The Local Server sorts the same way; without the id tie-break two rows
    // with the same key would come back in heap order and the backends would
    // disagree (the milestones R2 finding).
    const orders = {}
    const c = makeClient({ projects: PROJECT_ROW })
    const base = c.from
    c.from = (table) => {
      const b = base(table)
      b.order = (col) => { (orders[table] ||= []).push(col); return b }
      return b
    }
    globalThis.__testSupabase = c
    resetSupabaseAdapter()

    await supabaseAdapter().loadProject('p1')
    expect(orders.shot_lists).toEqual(['created_at', 'id'])
    expect(orders.shot_list_items).toEqual(['position', 'id'])
    expect(orders.edits).toEqual(['created_at', 'id'])
  })

  for (const [label, missing] of [['42P01', MISSING_42P01], ['PGRST205', MISSING_PGRST205]]) {
    it(`degrades each of the three to [] on a database without 0084 (${label})`, async () => {
      globalThis.__testSupabase = makeClient({
        projects:        PROJECT_ROW,
        shot_lists:      missing('shot_lists'),
        shot_list_items: missing('shot_list_items'),
        edits:           missing('edits'),
      })
      resetSupabaseAdapter()

      const bundle = await supabaseAdapter().loadProject('p1')
      expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
      expect(bundle.shotLists).toEqual([])
      expect(bundle.shotListItems).toEqual([])
      expect(bundle.edits).toEqual([])
    })
  }

  for (const table of Object.keys(SHOT_TABLES)) {
    it(`does NOT swallow a genuine ${table} error — only a missing table is absorbed`, async () => {
      // The failing control for the two tests above. A trailing
      // `.catch(() => [])` on any of the three reads would turn an RLS refusal
      // into "this project has no shot lists" and make this red.
      globalThis.__testSupabase = makeClient({
        projects: PROJECT_ROW,
        [table]:  { data: null, error: { code: '42501', message: `permission denied for table ${table}` } },
      })
      resetSupabaseAdapter()

      await expect(supabaseAdapter().loadProject('p1')).rejects.toThrow(/permission denied/)
    })
  }
})

// A client that records every write and RPC. Reads resolve from `perTable`
// exactly as makeClient's do; a write resolves to `perWrite[table]` when given
// (a function of the recorded write, or a fixed result), else echoes the row
// back as the stored row.
//
// DELETE (round 1, deleteShotListItems) records its filters: a delete entry is
// `{ table, op: 'delete', filters: [['eq', col, v] | ['in', col, vs]], select }`,
// and by default answers the `in` ids as the deleted rows. Only a delete entry
// carries `filters` / `select`, so the upsert entries the older tests compare
// with toEqual keep their three keys. `reads` lists every table READ, in order.
//
// Round 2 (R2-4): a READ records the same way in `readQueries` —
// `{ table, select, filters }` — and a `perTable` entry may be a function of
// that query, so a test can answer a filtered read from a small table of rows
// (`tableOf` below) instead of a fixed result.
function recordingClient(perTable = {}, { perWrite = {}, rpc = null } = {}) {
  const writes = []
  const rpcs = []
  const reads = []
  const readQueries = []
  const c = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => {
      let written = null
      let entry = null
      const query = { table, select: undefined, filters: [] }
      const record = (op) => (row) => { written = row; entry = { table, op, row }; writes.push(entry); return b }
      const b = {
        select: (cols) => { if (entry?.op === 'delete') entry.select = cols; else if (!entry) query.select = cols; return b },
        eq: (col, v) => { if (entry?.op === 'delete') entry.filters.push(['eq', col, v]); else if (!entry) query.filters.push(['eq', col, v]); return b },
        in: (col, vs) => { if (entry?.op === 'delete') entry.filters.push(['in', col, vs]); else if (!entry) query.filters.push(['in', col, vs]); return b },
        order: () => b, single: () => b, range: () => b,
        upsert: record('upsert'), update: record('update'), insert: record('insert'),
        delete: () => { written = {}; entry = { table, op: 'delete', filters: [] }; writes.push(entry); return b },
        then: (resolve, reject) => {
          if (written === null) { reads.push(table); readQueries.push(query) }
          const echo = () => entry?.op === 'delete'
            ? { data: ((entry.filters.find(f => f[0] === 'in') || [])[2] || []).map(id => ({ id })), error: null }
            : { data: { ...written }, error: null }
          const given = perWrite[table]
          const read = perTable[table]
          const result = written === null
            ? (table in perTable ? (typeof read === 'function' ? read(query) : read) : { data: [], error: null })
            : (table in perWrite ? (typeof given === 'function' ? given(entry) : given) : echo())
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return b
    },
    rpc: async (name, args) => {
      rpcs.push({ name, args })
      return rpc ? rpc(name, args) : { data: null, error: null }
    },
  }
  return { client: c, writes, rpcs, reads, readQueries, perTable }
}

// A tiny table for the fake: answers a read or a delete with the rows its
// eq / in filters match, cut to `id` (the only column these paths select).
// `rowsMatching(filters)` is what both a read and a DELETE would see.
function tableOf(rows) {
  const rowsMatching = (filters) => rows.filter(r => filters.every(([op, col, v]) => (
    op === 'eq' ? r[col] === v : v.includes(r[col]))))
  return {
    read: (q) => ({ data: rowsMatching(q.filters).map(r => ({ id: r.id })), error: null }),
    rowsMatching,
  }
}

function install(rec) {
  globalThis.__testSupabase = rec.client
  resetSupabaseAdapter()
  resetShotListSchemaState()
  return supabaseAdapter()
}

// One write of each of the four tables 0084 widens, carrying every 0084 key.
async function writeEveryWidenedTable(adapter) {
  await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1', shot_id: 'sh1' })
  await adapter.patchTask('t1', { title: 'Grade SC1', scene_id: 'sc1', shot_id: 'sh1' })
  await adapter.upsertAsset({ id: 'a1', project_id: 'p1', name: 'Hero', scene_ids: ['sc1'], shot_ids: ['sh1'] })
  await adapter.patchAsset('a1', { name: 'Hero v2', scene_ids: ['sc1'] })
  await adapter.upsertBudgetVersion({ id: 'bv1', project_id: 'p1', name: 'Bid', shot_list_id: 'l1', summary: 'pickups' })
  await adapter.updateProject('p1', { title: 'Renamed', active_shot_list_id: 'l1' })
  await adapter.createProject({ title: 'New', active_shot_list_id: 'l1' })
}

const ADDED_BY_0084 = {
  tasks: ['scene_id', 'shot_id'],
  assets: ['scene_ids', 'shot_ids'],
  budget_versions: ['shot_list_id', 'summary'],
  projects: ['active_shot_list_id'],
}

function keysOf0084(writes) {
  return writes.map(w => ({
    table: w.table, op: w.op,
    kept: (ADDED_BY_0084[w.table] || []).filter(k => k in w.row),
  }))
}

describe('a database WITHOUT 0084 — the load is the probe', () => {
  let warn
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it('after a load that finds shot_lists MISSING, no write of the four widened tables sends a 0084 column', async () => {
    // One unknown column PGRST204s a whole PostgREST write, and TimelineView
    // sends scene_id on EVERY task save — so on an older database the widened
    // allowlists alone would kill every task save. The load already answered
    // the question; no extra request is made.
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    await writeEveryWidenedTable(adapter)

    expect(keysOf0084(rec.writes)).toEqual([
      { table: 'tasks', op: 'upsert', kept: [] },
      { table: 'tasks', op: 'update', kept: [] },
      { table: 'assets', op: 'upsert', kept: [] },
      { table: 'assets', op: 'update', kept: [] },
      { table: 'budget_versions', op: 'upsert', kept: [] },
      { table: 'projects', op: 'update', kept: [] },
      { table: 'projects', op: 'insert', kept: [] },
    ])
    // ...and the rest of each write still goes out.
    expect(rec.writes[0].row).toEqual({ id: 't1', project_id: 'p1', title: 'Grade' })
    expect(rec.writes[1].row).toEqual({ title: 'Grade SC1' })
    expect(rec.writes[5].row).toEqual({ title: 'Renamed' })
  })

  it('CONTROL: after a load that FINDS shot_lists, the same writes carry every 0084 column', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: { data: [], error: null } })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    await writeEveryWidenedTable(adapter)

    expect(keysOf0084(rec.writes)).toEqual([
      { table: 'tasks', op: 'upsert', kept: ['scene_id', 'shot_id'] },
      { table: 'tasks', op: 'update', kept: ['scene_id', 'shot_id'] },
      { table: 'assets', op: 'upsert', kept: ['scene_ids', 'shot_ids'] },
      { table: 'assets', op: 'update', kept: ['scene_ids'] },
      { table: 'budget_versions', op: 'upsert', kept: ['shot_list_id', 'summary'] },
      { table: 'projects', op: 'update', kept: ['active_shot_list_id'] },
      { table: 'projects', op: 'insert', kept: ['active_shot_list_id'] },
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  // Post-overhaul S3c, step 2 (D18): the Budget's "Based on shot list" goes
  // out whole — the column, and the label frozen into the snapshot.
  it('S3c: a bid version\'s shot_list_id and its snapshot\'s frozen shot_list both go out', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: { data: [], error: null } })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    await adapter.upsertBudgetVersion({ id: 'bv2', project_id: 'p1', name: 'Bid on Shoot', type: 'bid', is_active: false,
      shot_list_id: 'l1', snapshot: { grandTotal: 10, shot_list: { id: 'l1', title: 'Shoot', version: 2 } } })
    const row = rec.writes.find((w) => w.table === 'budget_versions').row
    expect(row.shot_list_id).toBe('l1')
    expect(row.snapshot.shot_list).toEqual({ id: 'l1', title: 'Shoot', version: 2 })
  })

  it('PGRST205 (PostgREST\'s own "no such table") is the same answer', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_PGRST205('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).not.toHaveProperty('scene_id')
  })

  it('warns when a real link is lost, and stays quiet for the null TimelineView sends every time', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')

    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: null, shot_id: null })
    expect(warn).not.toHaveBeenCalled()

    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('0084')
    expect(warn.mock.calls[0][0]).toContain('scene_id')
    expect(warn.mock.calls[0][0]).toContain('public.tasks')
  })

  it('a patch that carried ONLY 0084 columns becomes no request at all', async () => {
    // patchRow's existing rule: nothing left → no-op, never an empty PATCH.
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    expect(await adapter.patchAsset('a1', { scene_ids: ['sc1'] })).toBeNull()
    expect(rec.writes).toEqual([])
  })

  it('an AUTH EVENT does not forget it: after resetSupabaseAdapter the Timeline save still strips (R1 cloud#0)', async () => {
    // RabbitProvider's onAuthStateChange calls resetSupabaseAdapter() on the
    // hourly TOKEN_REFRESHED and on the SIGNED_IN auth-js emits at every
    // hidden-to-visible switch, then reloads only the project LIST — never
    // the project, so no load re-learns the answer. When the reset cleared
    // the flag, TimelineView's next save (it always carries scene_id and
    // shot_id) went out whole and PGRST204'd on a database without 0084.
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')

    resetSupabaseAdapter()   // TOKEN_REFRESHED
    resetSupabaseAdapter()   // SIGNED_IN on the tab coming back
    const after = supabaseAdapter()
    await after.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1', shot_id: null })
    await after.patchTask('t1', { title: 'Grade SC1', scene_id: 'sc1', shot_id: 'sh1' })
    await after.patchAsset('a1', { name: 'Hero', scene_ids: ['sc1'] })
    expect(keysOf0084(rec.writes)).toEqual([
      { table: 'tasks', op: 'upsert', kept: [] },
      { table: 'tasks', op: 'update', kept: [] },
      { table: 'assets', op: 'update', kept: [] },
    ])
    // The shot-list writes keep refusing without a request, too.
    const err = await after.upsertShotListItems('p1', 'l1', [{ scene_id: 'sc1' }]).then(() => null, e => e)
    expect(err?.code).toBe('shot_lists_unavailable')
    expect(rec.rpcs).toEqual([])
  })

  it('CONTROL: resetShotListSchemaState (tests only) does forget it — the writes carry the columns again', async () => {
    // The pair to the test above: the flag is real state, and this is the
    // one reset that clears it outside a successful load.
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    resetShotListSchemaState()
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).toHaveProperty('scene_id', 'sc1')
  })

  it('a later load that finds the table clears it — a database migrated mid-session', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    rec.perTable.shot_lists = { data: [], error: null }
    await adapter.loadProject('p1')
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).toHaveProperty('scene_id', 'sc1')
  })

  it('CONTROL: a load REFUSED on shot_lists (42501) does not mark 0084 absent', async () => {
    // Only a missing relation is evidence about the schema. A refusal fails
    // the load and must leave the writes alone.
    const rec = recordingClient({
      projects: PROJECT_ROW,
      shot_lists: { data: null, error: { code: '42501', message: 'permission denied for table shot_lists' } },
    })
    const adapter = install(rec)
    await expect(adapter.loadProject('p1')).rejects.toThrow(/permission denied/)
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).toHaveProperty('scene_id', 'sc1')
  })

  it('every shot-list WRITE refuses with code shot_lists_unavailable, before any request', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    rec.writes.length = 0

    const calls = {
      upsertShotList:       () => adapter.upsertShotList({ project_id: 'p1', title: 'Pickups', version: 1 }),
      replaceShotListItems: () => adapter.replaceShotListItems('p1', 'l1', [{ scene_id: 'sc1' }]),
      upsertShotListItems:  () => adapter.upsertShotListItems('p1', 'l1', [{ scene_id: 'sc1' }]),
      repositionShotListItems: () => adapter.repositionShotListItems('p1', 'l1', [{ id: 'i1', position: 0 }]),
      deleteShotListItems:  () => adapter.deleteShotListItems('p1', 'l1', ['i1']),
      upsertEdit:           () => adapter.upsertEdit({ project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 1, items: [] }),
      setActiveShotList:    () => adapter.setActiveShotList('p1', 'l1'),
      archiveShotList:      () => adapter.archiveShotList('p1', 'l1'),
      archiveEdit:          () => adapter.archiveEdit('p1', 'e1'),
    }
    for (const [name, call] of Object.entries(calls)) {
      const err = await call().then(() => null, e => e)
      expect(err, `${name} did not refuse`).toBeInstanceOf(Error)
      expect(err.code, name).toBe('shot_lists_unavailable')
      expect(err.message, name).toBe('[supabase] Shot lists are not on this database yet (migration 0084).')
    }
    expect(rec.writes).toEqual([])
    expect(rec.rpcs).toEqual([])
  })

  it('CONTROL: a refused READ still throws, and keeps its code', async () => {
    // Only a missing table reads as []; an RLS refusal is "could not look".
    for (const [table, method] of [['shot_lists', 'listShotLists'], ['shot_list_items', 'listShotListItems'], ['edits', 'listEdits']]) {
      const rec = recordingClient({
        projects: PROJECT_ROW,
        [table]: { data: null, error: { code: '42501', message: `permission denied for table ${table}` } },
      })
      const adapter = install(rec)
      const err = await adapter[method]('p1').then(() => null, e => e)
      expect(err, `${method} swallowed a refusal`).toBeInstanceOf(Error)
      expect(err.code, method).toBe('42501')
      expect(err.message, method).toBe(`[supabase] permission denied for table ${table}`)
    }
  })

  it('the three READS answer [] there — the same answer loadProject gives', async () => {
    const rec = recordingClient({
      projects: PROJECT_ROW,
      shot_lists: MISSING_42P01('shot_lists'),
      shot_list_items: MISSING_42P01('shot_list_items'),
      edits: MISSING_42P01('edits'),
    })
    const adapter = install(rec)
    expect(await adapter.listShotLists('p1')).toEqual([])
    expect(await adapter.listShotListItems('p1')).toEqual([])
    expect(await adapter.listEdits('p1')).toEqual([])
  })
})

describe('the shot-list RPCs send the exact function and parameter names (0084 §10)', () => {
  // 🚨 PostgREST resolves an RPC by its parameter NAMES. A wrong p_* name is
  // answered PGRST202 — the same code as "the function does not exist" — so a
  // typo here would read as "0084 is missing" rather than as a bug.
  function rpcClient(reply) {
    return recordingClient({ projects: PROJECT_ROW }, { rpc: reply })
  }

  it('setActiveShotList → set_active_shot_list(p_project, p_list), returns the new active id', async () => {
    const rec = rpcClient((_n, args) => ({ data: args.p_list, error: null }))
    const adapter = install(rec)
    expect(await adapter.setActiveShotList('p1', 'l1')).toBe('l1')
    expect(rec.rpcs[0]).toStrictEqual({ name: 'set_active_shot_list', args: { p_project: 'p1', p_list: 'l1' } })
  })

  it('setActiveShotList(projectId, null) clears — p_list is still NAMED, as null', async () => {
    // Omitting p_list would send a one-argument call and PGRST202.
    const rec = rpcClient(() => ({ data: null, error: null }))
    const adapter = install(rec)
    expect(await adapter.setActiveShotList('p1', null)).toBeNull()
    expect(await adapter.setActiveShotList('p1', undefined)).toBeNull()
    expect(rec.rpcs[0].args).toStrictEqual({ p_project: 'p1', p_list: null })
    expect(rec.rpcs[1].args).toStrictEqual({ p_project: 'p1', p_list: null })
  })

  it('archiveShotList → archive_shot_list(p_list, p_archived), default true, false restores', async () => {
    const row = { id: 'l2', archived_at: '2026-09-30T00:00:00Z' }
    const rec = rpcClient(() => ({ data: row, error: null }))
    const adapter = install(rec)
    expect(await adapter.archiveShotList('p1', 'l2')).toEqual(row)
    await adapter.archiveShotList('p1', 'l2', false)
    expect(rec.rpcs[0]).toStrictEqual({ name: 'archive_shot_list', args: { p_list: 'l2', p_archived: true } })
    expect(rec.rpcs[1]).toStrictEqual({ name: 'archive_shot_list', args: { p_list: 'l2', p_archived: false } })
  })

  it('archiveEdit → archive_edit(p_edit, p_archived), default true, false restores', async () => {
    const row = { id: 'e1', archived_at: null }
    const rec = rpcClient(() => ({ data: row, error: null }))
    const adapter = install(rec)
    expect(await adapter.archiveEdit('p1', 'e1', false)).toEqual(row)
    await adapter.archiveEdit('p1', 'e1')
    expect(rec.rpcs[0]).toStrictEqual({ name: 'archive_edit', args: { p_edit: 'e1', p_archived: false } })
    expect(rec.rpcs[1]).toStrictEqual({ name: 'archive_edit', args: { p_edit: 'e1', p_archived: true } })
  })

  it('replaceShotListItems → replace_shot_list_items(p_list, p_items), items cut to the four keys the function reads', async () => {
    const after = [{ id: 'i1', shot_list_id: 'l1', scene_id: 'sc1', shot_id: null, position: 0 }]
    const rec = rpcClient(() => ({ data: after, error: null }))
    const adapter = install(rec)
    const out = await adapter.replaceShotListItems('p1', 'l1', [
      // a whole provider row: the extra keys must not reach the RPC
      { id: 'i1', shot_list_id: 'l1', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 0, created_at: 'x' },
      // a new item: no id, no position (the function uses its index)
      { shot_id: 'sh1' },
    ])
    expect(out).toEqual(after)
    expect(rec.rpcs[0]).toStrictEqual({
      name: 'replace_shot_list_items',
      args: {
        p_list: 'l1',
        p_items: [
          { id: 'i1', scene_id: 'sc1', shot_id: null, position: 0 },
          { id: null, scene_id: null, shot_id: 'sh1', position: null },
        ],
      },
    })
  })

  it('a missing id is SENT as null, so every call still names all its parameters', async () => {
    // JSON drops an undefined key; PostgREST would then look for a function
    // with fewer parameters and answer PGRST202 — "0084 is missing" — for what
    // is really a caller bug. With the key present as null, the function runs
    // and answers with its own "not found".
    const rec = rpcClient(() => ({ data: null, error: null }))
    const adapter = install(rec)
    await adapter.setActiveShotList(undefined, undefined)
    await adapter.archiveShotList('p1', undefined)
    await adapter.archiveEdit('p1', undefined)
    await adapter.replaceShotListItems('p1', undefined, [])
    expect(rec.rpcs.map(r => r.args)).toStrictEqual([
      { p_project: null, p_list: null },
      { p_list: null, p_archived: true },
      { p_edit: null, p_archived: true },
      { p_list: null, p_items: [] },
    ])
  })

  it('replaceShotListItems with no items still names p_items (null) — the database says "items must be a JSON array"', async () => {
    const rec = rpcClient(() => ({ data: null, error: { code: '22023', message: 'items must be a JSON array' } }))
    const adapter = install(rec)
    const err = await adapter.replaceShotListItems('p1', 'l1', undefined).then(() => null, e => e)
    expect(rec.rpcs[0].args).toStrictEqual({ p_list: 'l1', p_items: null })
    expect(err.code).toBe('22023')
    expect(err.message).toBe('[supabase] items must be a JSON array')
  })
})

describe('refusals keep the Postgres / PostgREST code on err.code (0084)', () => {
  it('a seat refusal from set_active_shot_list arrives as 42501 with the SQL sentence', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: '42501', message: 'only a project manager or a workspace admin can change the active shot list' } }),
    })
    const adapter = install(rec)
    const err = await adapter.setActiveShotList('p1', 'l1').then(() => null, e => e)
    expect(err.code).toBe('42501')
    expect(err.message).toBe('[supabase] only a project manager or a workspace admin can change the active shot list')
  })

  it('archiving the ACTIVE list arrives as P0001', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'the active shot list cannot be archived — make another list active first' } }),
    })
    const adapter = install(rec)
    const err = await adapter.archiveShotList('p1', 'l1').then(() => null, e => e)
    expect(err.code).toBe('P0001')
    expect(err.message).toContain('the active shot list cannot be archived')
  })

  it('a duplicate "Title · vN" on upsertShotList arrives as 23505; an archived edit as 42501', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      perWrite: {
        shot_lists: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shot_lists_project_title_version_key"' } },
        edits:      { data: null, error: { code: '42501', message: 'this edit is archived — restore it before changing it' } },
      },
    })
    const adapter = install(rec)
    const dup = await adapter.upsertShotList({ project_id: 'p1', title: 'Shot list 1', version: 1 }).then(() => null, e => e)
    expect(dup.code).toBe('23505')
    const frozen = await adapter.upsertEdit({ id: 'e1', project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 1, items: [] }).then(() => null, e => e)
    expect(frozen.code).toBe('42501')
    expect(frozen.message).toBe('[supabase] this edit is archived — restore it before changing it')
  })

  it('upsertShotList / upsertEdit send the allowlisted row and return the stored row', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    const stored = await adapter.upsertShotList({ id: 'l1', project_id: 'p1', title: 'Pickups', version: 2, label: 'Pickups · v2' })
    expect(rec.writes[0]).toEqual({ table: 'shot_lists', op: 'upsert', row: { id: 'l1', project_id: 'p1', title: 'Pickups', version: 2 } })
    expect(stored).toEqual({ id: 'l1', project_id: 'p1', title: 'Pickups', version: 2 })
    await adapter.upsertEdit({ id: 'e1', project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 1, items: [{ id: 'x', shot_id: 'sh1', label: 'Wide', notes: '' }] })
    expect(rec.writes[1].table).toBe('edits')
    expect(rec.writes[1].row.items).toEqual([{ id: 'x', shot_id: 'sh1', label: 'Wide', notes: '' }])
  })

  it('a row without project_id is refused client-side with code invalid, before any request', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    const a = await adapter.upsertShotList({ title: 'Pickups', version: 1 }).then(() => null, e => e)
    const b = await adapter.upsertEdit({ title: 'Cut', version: 1 }).then(() => null, e => e)
    expect(a.code).toBe('invalid')
    expect(b.code).toBe('invalid')
    expect(rec.writes).toEqual([])
  })

  it('a MISSING function (PGRST202) — before any load — becomes shot_lists_unavailable AND marks 0084 absent', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.set_active_shot_list(p_list, p_project) in the schema cache' } }),
    })
    const adapter = install(rec)
    const err = await adapter.setActiveShotList('p1', 'l1').then(() => null, e => e)
    expect(err.code).toBe('shot_lists_unavailable')
    // ...and it is remembered: the task write that follows strips scene_id.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).not.toHaveProperty('scene_id')
  })

  it('a 42883 naming the function itself is the same answer', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: '42883', message: 'function public.archive_edit(uuid, boolean) does not exist' } }),
    })
    const adapter = install(rec)
    const err = await adapter.archiveEdit('p1', 'e1').then(() => null, e => e)
    expect(err.code).toBe('shot_lists_unavailable')
  })

  it('CONTROL: a 42883 raised INSIDE the function (another name) is a real failure and marks nothing', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: '42883', message: 'function public.passes_project_privacy(uuid) does not exist' } }),
    })
    const adapter = install(rec)
    const err = await adapter.archiveShotList('p1', 'l1').then(() => null, e => e)
    expect(err.code).toBe('42883')
    expect(err.message).toContain('passes_project_privacy')
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).toHaveProperty('scene_id', 'sc1')
  })

  it('a missing TABLE on a write (PGRST205) becomes shot_lists_unavailable; a 42P01 naming another relation does not', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      perWrite: {
        edits:      MISSING_PGRST205('edits'),
        shot_lists: { data: null, error: { code: '42P01', message: 'relation "public.some_helper" does not exist' } },
      },
    })
    const adapter = install(rec)
    const real = await adapter.upsertShotList({ project_id: 'p1', title: 'Pickups', version: 1 }).then(() => null, e => e)
    expect(real.code).toBe('42P01')
    const gone = await adapter.upsertEdit({ project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 1, items: [] }).then(() => null, e => e)
    expect(gone.code).toBe('shot_lists_unavailable')
  })

  // A SOURCE PIN, for the reason the listTrashedMilestones one above gives:
  // lastError / lastSyncAt are module-scope and status() re-probes, so there
  // is no behavioural vantage point. It guards the shot-list unwrap against
  // the R2 defect — a hand-rolled error block that skips the bookkeeping.
  it('unwrapShotList records lastError and lastSyncAt like every other path in the file', () => {
    const SRC = readFileSync(new URL('./supabaseAdapter.js', import.meta.url), 'utf-8')
    const start = SRC.indexOf('function unwrapShotList(')
    expect(start, 'unwrapShotList moved or was renamed').toBeGreaterThan(-1)
    // To the function's closing brace at column 0.
    const end = SRC.indexOf(String.fromCharCode(10) + '}', start)
    const body = SRC.slice(start, end)
    expect(body).toContain('lastError = msg')
    expect(body).toContain('lastError  = null')
    expect(body).toContain('lastSyncAt = new Date()')
    expect(body).toContain('err.code = error.code')
  })
})


// ── Review round 1 (2026-09-30): deltas, the strip ──────────────────────────
// (Round 1 also froze an archived list's membership; round 2 reverted that,
// R2-1, and the delete tests below say so where they used to pin it.)

describe('membership is written as DELTAS (R1 addendum A)', () => {
  // Items are not broadcast, so a whole-set replace from one client's view
  // deleted the items a collaborator had added since it loaded (R1
  // provider#0). The provider now writes only the rows it names.

  it('upsertShotListItems → upsert_shot_list_items(p_list, p_items, p_positions_only: false), items cut to the four keys; answers the rows the database wrote', async () => {
    // The function SKIPS an id that belongs to another list (its ON CONFLICT
    // … WHERE same list), so the answer is the database's rows, not the input
    // echoed back.
    const written = [{ id: 'i1', shot_list_id: 'l1', scene_id: 'sc1', shot_id: null, position: 2 }]
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: written, error: null }) })
    const adapter = install(rec)
    const out = await adapter.upsertShotListItems('p1', 'l1', [
      // a whole provider row: the extra keys must not reach the RPC
      { id: 'i1', shot_list_id: 'l1', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 2, created_at: 'x' },
      { id: 'i-other-list', shot_id: 'sh9', position: 0 },
      // a new item: no id, no position (the function uses its index)
      { shot_id: 'sh1' },
    ])
    expect(out).toEqual(written)
    expect(rec.rpcs).toStrictEqual([{
      name: 'upsert_shot_list_items',
      args: {
        p_list: 'l1',
        p_items: [
          { id: 'i1', scene_id: 'sc1', shot_id: null, position: 2 },
          { id: 'i-other-list', scene_id: null, shot_id: 'sh9', position: 0 },
          { id: null, scene_id: null, shot_id: 'sh1', position: null },
        ],
        // R2-2: the INSERTING arm is asked for by name, never left to the
        // parameter's default.
        p_positions_only: false,
      },
    }])
    // A delta: never the whole-set swap, and no direct table write.
    expect(rec.writes).toEqual([])
  })

  it('upsertShotListItems names EVERY parameter with nothing to name — the database answers, not PGRST202', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: '22023', message: 'items must be a JSON array' } }),
    })
    const adapter = install(rec)
    const err = await adapter.upsertShotListItems('p1', undefined, undefined).then(() => null, e => e)
    expect(rec.rpcs[0].args).toStrictEqual({ p_list: null, p_items: null, p_positions_only: false })
    expect(err.code).toBe('22023')
    expect(err.message).toBe('[supabase] items must be a JSON array')
  })

  it('an upsert the table refuses keeps its code: a caller without write rights (42501), a scene or shot twice (23505)', async () => {
    // Round 2 reverted the archived-list freeze (R2-1), so a policy 42501
    // here is a caller who may not change this project's lists (D8), never
    // "archived". The 23505 keeps its code and speaks the contract (R2-3).
    for (const [error, said] of [
      [{ code: '42501', message: 'new row violates row-level security policy for table "shot_list_items"' },
        'new row violates row-level security policy for table "shot_list_items"'],
      [{ code: '23505', message: 'duplicate key value violates unique constraint "shot_list_items_list_shot_key"' },
        'a shot list holds each scene and each shot once'],
    ]) {
      const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: null, error }) })
      const adapter = install(rec)
      const err = await adapter.upsertShotListItems('p1', 'l1', [{ shot_id: 'sh1' }]).then(() => null, e => e)
      expect(err, error.code).toBeInstanceOf(Error)
      expect(err.code).toBe(error.code)
      expect(err.message).toBe(`[supabase] ${said}`)
    }
  })

  it('deleteShotListItems → DELETE shot_list_items WHERE shot_list_id = list AND id IN (ids) RETURNING id; answers { deleted }', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    // A repeat is sent once; a blank is not sent.
    const out = await adapter.deleteShotListItems('p1', 'l1', ['i1', 'i2', 'i1', null, ''])
    expect(out).toStrictEqual({ deleted: ['i1', 'i2'] })
    expect(rec.writes).toStrictEqual([{
      table: 'shot_list_items', op: 'delete',
      // The list filter is what leaves ANOTHER list's item alone when its id
      // is named; `select('id')` makes the answer what was really deleted.
      filters: [['eq', 'shot_list_id', 'l1'], ['in', 'id', ['i1', 'i2']]],
      select: 'id',
    }])
    // Everything named was deleted: no second request.
    expect(rec.reads).toEqual([])
    expect(rec.rpcs).toEqual([])
  })

  it('an id not in the list is ignored: a shortfall answers what was really deleted, after ONE read of the ids not deleted', async () => {
    // i1 was deleted; i-elsewhere is not a row of l1 (gone, or never there).
    // Something WAS deleted, so the list exists: no second read for it.
    const items = tableOf([{ id: 'i2', shot_list_id: 'l1' }])
    const rec = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: items.read },
      { perWrite: { shot_list_items: { data: [{ id: 'i1' }], error: null } } },
    )
    const adapter = install(rec)
    expect(await adapter.deleteShotListItems('p1', 'l1', ['i1', 'i-elsewhere'])).toStrictEqual({ deleted: ['i1'] })
    expect(rec.reads).toEqual(['shot_list_items'])
    expect(rec.readQueries[0]).toStrictEqual({
      table: 'shot_list_items', select: 'id',
      // Only the ids the DELETE did not remove, and only in THIS list.
      filters: [['eq', 'shot_list_id', 'l1'], ['in', 'id', ['i-elsewhere']]],
    })
  })

  it('R2-4: a named row STILL in the list after the DELETE is a refusal — 42501 "you cannot change this shot list", not { deleted: [] }', async () => {
    // 🚨 A DELETE whose rows fail a policy's USING clause is not REFUSED —
    // the rows are invisible to it, and PostgREST answers 200 with []. A
    // caller without write rights (a seat removed while the page was open)
    // got a quiet { deleted: [] } and the remove looked ignored (r2
    // closure#10). The rows are still there, and SELECT can see them.
    const items = tableOf([
      { id: 'i1', shot_list_id: 'l1' },
      { id: 'i2', shot_list_id: 'l1' },
    ])
    const rec = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: items.read, shot_lists: { data: [{ id: 'l1' }], error: null } },
      { perWrite: { shot_list_items: { data: [], error: null } } },
    )
    const adapter = install(rec)
    const err = await adapter.deleteShotListItems('p1', 'l1', ['i1', 'i2']).then(() => null, e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('42501')
    expect(err.message).toBe('[supabase] you cannot change this shot list')
    // One read answered it: the list is plainly there.
    expect(rec.reads).toEqual(['shot_list_items'])
  })

  it('R2-4: an id of ANOTHER list, rightly skipped by the DELETE, is not read as a refusal (the read is filtered by the list)', async () => {
    // i9 is l2's. The DELETE (filtered by l1) leaves it alone, and it still
    // exists — in l2. Read without the list filter it would look like a row
    // the caller could not delete.
    const items = tableOf([
      { id: 'i1', shot_list_id: 'l1' },
      { id: 'i9', shot_list_id: 'l2' },
    ])
    const rec = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: items.read },
      { perWrite: { shot_list_items: (entry) => ({ data: items.rowsMatching(entry.filters).map(r => ({ id: r.id })), error: null }) } },
    )
    const adapter = install(rec)
    expect(await adapter.deleteShotListItems('p1', 'l1', ['i1', 'i9'])).toStrictEqual({ deleted: ['i1'] })
  })

  it('R2-1: an ARCHIVED list is not frozen — the adapter no longer reads archived_at, and a shortfall there is a success', async () => {
    // Round 1 answered "this shot list is archived — restore it before
    // changing it" here. Round 2 reverted the freeze on every backend: the
    // undo of a scene delete must be able to put the scene back in archived
    // lists. Nothing deleted and nothing left: the ids were already gone.
    const rec = recordingClient(
      {
        projects: PROJECT_ROW,
        shot_list_items: tableOf([]).read,
        shot_lists: { data: [{ id: 'l2', archived_at: '2026-09-30T00:00:00Z' }], error: null },
      },
      { perWrite: { shot_list_items: { data: [], error: null } } },
    )
    const adapter = install(rec)
    expect(await adapter.deleteShotListItems('p1', 'l2', ['i1', 'i2'])).toStrictEqual({ deleted: [] })
    expect(rec.reads).toEqual(['shot_list_items', 'shot_lists'])
    // The list read asks whether it EXISTS, nothing more.
    expect(rec.readQueries[1]).toStrictEqual({ table: 'shot_lists', select: 'id', filters: [['eq', 'id', 'l2']] })
  })

  it('a list that is gone (or not visible) answers "shot list not found" (P0002, the RPCs\' answer)', async () => {
    const rec = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: tableOf([]).read, shot_lists: { data: [], error: null } },
      { perWrite: { shot_list_items: { data: [], error: null } } },
    )
    const adapter = install(rec)
    const err = await adapter.deleteShotListItems('p1', 'l-gone', ['i1']).then(() => null, e => e)
    expect(err.code).toBe('P0002')
    expect(err.message).toBe('[supabase] shot list not found')
  })

  it('the shortfall reads are best effort: when either fails, the rows really deleted are still the answer', async () => {
    // The DELETE happened. Throwing a read's error would make the provider
    // roll back items that are gone from the database.
    const down = { data: null, error: { code: '08006', message: 'connection failure' } }
    const recA = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: down },
      { perWrite: { shot_list_items: { data: [{ id: 'i1' }], error: null } } },
    )
    expect(await install(recA).deleteShotListItems('p1', 'l1', ['i1', 'i2'])).toStrictEqual({ deleted: ['i1'] })
    expect(recA.reads).toEqual(['shot_list_items'])

    const recB = recordingClient(
      { projects: PROJECT_ROW, shot_list_items: tableOf([]).read, shot_lists: down },
      { perWrite: { shot_list_items: { data: [], error: null } } },
    )
    expect(await install(recB).deleteShotListItems('p1', 'l1', ['i1'])).toStrictEqual({ deleted: [] })
    expect(recB.reads).toEqual(['shot_list_items', 'shot_lists'])
  })

  it('a DELETE refused outright keeps its code, and nothing is read after it', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      perWrite: { shot_list_items: { data: null, error: { code: '42501', message: 'permission denied for table shot_list_items' } } },
    })
    const adapter = install(rec)
    const err = await adapter.deleteShotListItems('p1', 'l1', ['i1']).then(() => null, e => e)
    expect(err.code).toBe('42501')
    expect(err.message).toBe('[supabase] permission denied for table shot_list_items')
    expect(rec.reads).toEqual([])
  })

  it('refuses before any request: no list id (P0002), ids not an array (invalid); an empty list of ids sends nothing', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    // `.eq('shot_list_id', null)` would reach PostgREST as the TEXT 'null'.
    const noList = await adapter.deleteShotListItems('p1', undefined, ['i1']).then(() => null, e => e)
    expect(noList.code).toBe('P0002')
    // A bare id string must not be read as "nothing to delete".
    const notArray = await adapter.deleteShotListItems('p1', 'l1', 'i1').then(() => null, e => e)
    expect(notArray.code).toBe('invalid')
    expect(await adapter.deleteShotListItems('p1', 'l1', [])).toStrictEqual({ deleted: [] })
    expect(rec.writes).toEqual([])
    expect(rec.reads).toEqual([])
  })

  it('a database without 0084: a missing upsert_shot_list_items (PGRST202) or shot_list_items (PGRST205) is shot_lists_unavailable, and remembered', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.upsert_shot_list_items(p_items, p_list) in the schema cache' } }),
    })
    const adapter = install(rec)
    const err = await adapter.upsertShotListItems('p1', 'l1', [{ shot_id: 'sh1' }]).then(() => null, e => e)
    expect(err.code).toBe('shot_lists_unavailable')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await adapter.upsertTask({ id: 't1', project_id: 'p1', title: 'Grade', scene_id: 'sc1' })
    expect(rec.writes[0].row).not.toHaveProperty('scene_id')

    const rec2 = recordingClient({ projects: PROJECT_ROW }, { perWrite: { shot_list_items: MISSING_PGRST205('shot_list_items') } })
    const adapter2 = install(rec2)
    const gone = await adapter2.deleteShotListItems('p1', 'l1', ['i1']).then(() => null, e => e)
    expect(gone.code).toBe('shot_lists_unavailable')
    expect(gone.message).toBe('[supabase] Shot lists are not on this database yet (migration 0084).')
    expect(rec2.reads).toEqual([])
  })
})


// ── Review round 2 (2026-09-30): the reorder, the sentences, the refusal ────

describe('a reorder is POSITIONS-ONLY — it never inserts (R2-2)', () => {
  // planReorderList renumbers a whole group from this client's cached view.
  // Sent through the upsert, an item a collaborator had removed since came
  // back for everyone (r2 sql2#1, provider2#2, parity2#0). The reorder now
  // asks the function's UPDATE-only arm, which skips ids it does not find.

  it('repositionShotListItems → upsert_shot_list_items(p_list, p_items cut to { id, position }, p_positions_only: true); answers the rows updated', async () => {
    const updated = [{ id: 'i3', shot_list_id: 'l1', scene_id: 'sc3', shot_id: null, position: 0 }]
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: updated, error: null }) })
    const adapter = install(rec)
    const out = await adapter.repositionShotListItems('p1', 'l1', [
      // a whole provider row: only the id and the position may reach the RPC
      { id: 'i3', shot_list_id: 'l1', project_id: 'p1', scene_id: 'sc3', shot_id: null, position: 0, created_at: 'x' },
      // a row a collaborator removed: sent, and the database skips it
      { id: 'i1', scene_id: 'sc1', position: 1 },
    ])
    expect(out).toEqual(updated)
    expect(rec.rpcs).toStrictEqual([{
      name: 'upsert_shot_list_items',
      args: {
        p_list: 'l1',
        p_items: [{ id: 'i3', position: 0 }, { id: 'i1', position: 1 }],
        p_positions_only: true,
      },
    }])
    expect(rec.writes).toEqual([])
  })

  it('CONTROL: the two item writes differ ONLY in the flag — the upsert asks for the inserting arm by name', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: [], error: null }) })
    const adapter = install(rec)
    await adapter.upsertShotListItems('p1', 'l1', [{ id: 'i1', scene_id: 'sc1', position: 0 }])
    await adapter.repositionShotListItems('p1', 'l1', [{ id: 'i1', position: 0 }])
    expect(rec.rpcs.map(r => [r.name, r.args.p_positions_only])).toStrictEqual([
      ['upsert_shot_list_items', false],
      ['upsert_shot_list_items', true],
    ])
  })

  it('refuses before any request what the UPDATE-only arm would get silently wrong', async () => {
    // The SQL arm skips an item with no id, gives a missing position the
    // item's INDEX (a forgotten position would move the row), and updates a
    // row named twice from either entry. The Local Server refuses all four
    // with these sentences; so does this adapter, without a request.
    const POSITION = '[supabase] an item\'s position must be a whole number of at least 0'
    const NEEDS_ID = '[supabase] each item of a reorder needs an id'
    const cases = [
      ['not an array', 'i1', '[supabase] items must be a JSON array'],
      ['no items at all', undefined, '[supabase] items must be a JSON array'],
      ['an item without an id', [{ position: 0 }], NEEDS_ID],
      ['an id of null', [{ id: null, position: 0 }], NEEDS_ID],
      ['a blank id', [{ id: '', position: 0 }], NEEDS_ID],
      ['an item that is not an object', ['i1'], NEEDS_ID],
      ['a missing position', [{ id: 'i1' }], POSITION],
      ['a negative position', [{ id: 'i1', position: -1 }], POSITION],
      ['a fractional position', [{ id: 'i1', position: 1.5 }], POSITION],
      ['a numeric STRING position', [{ id: 'i1', position: '2' }], POSITION],
      ['an id named twice', [{ id: 'i1', position: 0 }, { id: 'i1', position: 3 }], '[supabase] an item id appears more than once'],
    ]
    for (const [label, items, message] of cases) {
      const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: [], error: null }) })
      const adapter = install(rec)
      const err = await adapter.repositionShotListItems('p1', 'l1', items).then(() => null, e => e)
      expect(err, `${label}: not refused`).toBeInstanceOf(Error)
      expect(err.code, label).toBe('invalid')
      expect(err.message, label).toBe(message)
      expect(rec.rpcs, `${label}: a request went out`).toEqual([])
    }
  })

  it('in payload order, as the Local Server checks: the first bad item answers', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    const err = await adapter.repositionShotListItems('p1', 'l1', [
      { id: 'i1', position: -1 },
      { position: 0 },
    ]).then(() => null, e => e)
    expect(err.message).toBe('[supabase] an item\'s position must be a whole number of at least 0')
  })

  it('an empty reorder still asks — a list that is not there answers "shot list not found" (P0002); a missing list id is SENT as null', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: 'P0002', message: 'shot list not found' } }),
    })
    const adapter = install(rec)
    const err = await adapter.repositionShotListItems('p1', undefined, []).then(() => null, e => e)
    expect(err.code).toBe('P0002')
    expect(err.message).toBe('[supabase] shot list not found')
    expect(rec.rpcs[0].args).toStrictEqual({ p_list: null, p_items: [], p_positions_only: true })
  })

  it('a database without 0084: a missing upsert_shot_list_items (PGRST202) is shot_lists_unavailable', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.upsert_shot_list_items(p_items, p_list, p_positions_only) in the schema cache' } }),
    })
    const adapter = install(rec)
    const err = await adapter.repositionShotListItems('p1', 'l1', [{ id: 'i1', position: 0 }]).then(() => null, e => e)
    expect(err.code).toBe('shot_lists_unavailable')
  })
})

describe('the six unique violations speak the contract\'s sentences (R2-3)', () => {
  // The provider pre-checks the chain and "Title · vN" against its own
  // view; edits and items are not broadcast, so when that view is stale the
  // database's unique index is what refuses. The Local Server and the
  // fixtures answer those with the contract's words; so must the cloud.
  const dup = (name) => ({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${name}"` } })
  const CASES = [
    ['edits_one_root_per_list_key', 'edits', 'this shot list\'s edits form one chain — a new edit continues from the latest one'],
    ['edits_one_child_key', 'edits', 'an edit\'s parent must be the latest edit of its shot list'],
    ['edits_list_title_version_key', 'edits', 'This shot list already has an edit with this title and version.'],
    ['shot_lists_project_title_version_key', 'shot_lists', 'There is already a shot list with this title and version.'],
    ['shot_list_items_list_scene_key', 'rpc', 'a shot list holds each scene and each shot once'],
    ['shot_list_items_list_shot_key', 'rpc', 'a shot list holds each scene and each shot once'],
  ]
  const call = {
    edits: (a) => a.upsertEdit({ id: 'e2', project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 2, parent_edit_id: 'e1', items: [] }),
    shot_lists: (a) => a.upsertShotList({ project_id: 'p1', title: 'Pickups', version: 1 }),
    rpc: (a) => a.upsertShotListItems('p1', 'l1', [{ scene_id: 'sc1' }]),
  }

  for (const [constraint, via, sentence] of CASES) {
    it(`${constraint} → "${sentence}", still code 23505`, async () => {
      const rec = recordingClient({ projects: PROJECT_ROW }, {
        perWrite: { edits: dup(constraint), shot_lists: dup(constraint) },
        rpc: () => dup(constraint),
      })
      const adapter = install(rec)
      const err = await call[via](adapter).then(() => null, e => e)
      expect(err).toBeInstanceOf(Error)
      expect(err.code).toBe('23505')
      expect(err.message).toBe(`[supabase] ${sentence}`)
    })
  }

  it('the whole-set replace speaks the same sentence for an item twice', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => dup('shot_list_items_list_scene_key') })
    const adapter = install(rec)
    const err = await adapter.replaceShotListItems('p1', 'l1', [{ scene_id: 'sc1' }, { scene_id: 'sc1' }]).then(() => null, e => e)
    expect(err.code).toBe('23505')
    expect(err.message).toBe('[supabase] a shot list holds each scene and each shot once')
  })

  it('CONTROL: any OTHER 23505 keeps the database\'s text — a primary key, or a name that only starts like one of the six', async () => {
    for (const name of ['shot_lists_pkey', 'edits_one_child_key_v2', 'x_edits_one_child_key']) {
      const rec = recordingClient({ projects: PROJECT_ROW }, { perWrite: { shot_lists: dup(name) } })
      const adapter = install(rec)
      const err = await adapter.upsertShotList({ project_id: 'p1', title: 'Pickups', version: 1 }).then(() => null, e => e)
      expect(err.code, name).toBe('23505')
      expect(err.message, name).toBe(`[supabase] duplicate key value violates unique constraint "${name}"`)
    }
  })

  it('CONTROL: only a 23505 is translated — another code that mentions one of the names keeps its text', async () => {
    const error = { code: '42501', message: 'permission denied: unique constraint "edits_one_child_key" is not yours' }
    const rec = recordingClient({ projects: PROJECT_ROW }, { perWrite: { edits: { data: null, error } } })
    const adapter = install(rec)
    const err = await adapter.upsertEdit({ id: 'e2', project_id: 'p1', shot_list_id: 'l1', title: 'Cut', version: 2, items: [] }).then(() => null, e => e)
    expect(err.code).toBe('42501')
    expect(err.message).toBe(`[supabase] ${error.message}`)
  })
})

describe('upsertShotList / upsertEdit send no audit or archive column (R1 addendum F)', () => {
  const SERVER_OWNED = ['created_at', 'created_by', 'updated_at', 'updated_by', 'archived_at', 'archived_by']
  const rest = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !SERVER_OWNED.includes(k)))

  it('the six never go out; every other column still does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rec = recordingClient({ projects: PROJECT_ROW })
    const adapter = install(rec)
    // The backfilled list, re-sent whole by a rename: created_by NULL (the
    // migration had no auth.uid()). Forwarded, fn_audit_touch stamped the
    // renamer into it and merge-duplicates wrote that over the NULL (cloud#4).
    const list = {
      id: 'l1', project_id: 'p1', workspace_id: 'w1', title: 'Shot list 1', version: 1,
      summary: 'Created from existing scenes', snapshot: {},
      archived_at: null, archived_by: null,
      created_at: '2026-09-30T00:00:00Z', created_by: null,
      updated_at: '2026-09-30T00:00:00Z', updated_by: null,
    }
    // An archived edit re-sent whole: unsent, its archived_at cannot trip the
    // guard's archive-columns arm, so the frozen-row sentence answers (cloud#3).
    const edit = {
      id: 'e1', project_id: 'p1', workspace_id: 'w1', shot_list_id: 'l1',
      title: 'Assembly', version: 2, summary: 'first pass', parent_edit_id: 'e0',
      items: [{ id: 'ei1', scene_id: 'sc1', shot_id: 'sh1', label: 'Wide', notes: '' }], snapshot: null,
      archived_at: '2026-09-30T01:00:00Z', archived_by: 'u9',
      created_at: '2026-09-30T00:00:00Z', created_by: 'u1',
      updated_at: '2026-09-30T00:00:00Z', updated_by: 'u1',
    }
    await adapter.upsertShotList(list)
    await adapter.upsertEdit(edit)
    expect(rec.writes.map(w => [w.table, w.op])).toEqual([['shot_lists', 'upsert'], ['edits', 'upsert']])
    const [sentList, sentEdit] = rec.writes.map(w => w.row)
    for (const k of SERVER_OWNED) {
      expect(sentList, `the shot_lists upsert sent ${k}`).not.toHaveProperty(k)
      expect(sentEdit, `the edits upsert sent ${k}`).not.toHaveProperty(k)
    }
    // The planted half: everything else goes out exactly as given.
    expect(sentList).toStrictEqual(rest(list))
    expect(sentEdit).toStrictEqual(rest(edit))
    // Stripped BEFORE toColumns (the allowlists still list all six — they
    // describe the table), so a whole-row re-send warns about nothing.
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('patchShotList (post-overhaul S3b): an UPDATE of the named columns, nothing else', () => {
  // Its own small fake: the recording client keeps no filters for an update.
  function patchClient(result) {
    const sent = []
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: (table) => {
        const entry = { table, op: null, row: null, filters: [], select: undefined }
        const b = {
          update: (row) => { entry.op = 'update'; entry.row = row; sent.push(entry); return b },
          upsert: (row) => { entry.op = 'upsert'; entry.row = row; sent.push(entry); return b },
          eq: (col, v) => { entry.filters.push([col, v]); return b },
          select: (cols) => { entry.select = cols ?? '*'; return b },
          single: () => b, order: () => b, in: () => b, range: () => b,
          then: (resolve, reject) => Promise.resolve(typeof result === 'function' ? result(entry) : result).then(resolve, reject),
        }
        return b
      },
      rpc: async () => ({ data: null, error: null }),
    }
    return { client, sent }
  }

  it('sends exactly the named columns as an UPDATE filtered by the list and its project, and answers the row — no cached summary rides along', async () => {
    const rec = patchClient({ data: [{ id: 'l1', project_id: 'p1', title: 'Main shoot', summary: 'Theirs, newer' }], error: null })
    const row = await install(rec).patchShotList('p1', 'l1', { title: 'Main shoot' })
    expect(rec.sent).toEqual([{ table: 'shot_lists', op: 'update', row: { title: 'Main shoot' }, filters: [['id', 'l1'], ['project_id', 'p1']], select: '*' }])
    expect(row).toMatchObject({ id: 'l1', title: 'Main shoot', summary: 'Theirs, newer' })
  })

  it('never sends the row\'s identity or a server-owned column, whatever the patch carries', async () => {
    const rec = patchClient({ data: [{ id: 'l1' }], error: null })
    await install(rec).patchShotList('p1', 'l1', {
      id: 'x', project_id: 'y', workspace_id: 'w', created_at: 'a', created_by: 'u', updated_at: 'b', updated_by: 'u',
      archived_at: 't', archived_by: 'u', summary: 'Kept', version: 3,
    })
    expect(rec.sent.map(e => e.row)).toEqual([{ summary: 'Kept', version: 3 }])
  })

  it('no row back — RLS let the UPDATE through to nothing — is the contract\'s refusal, 42501; a patch that names nothing sends nothing', async () => {
    const rec = patchClient({ data: [], error: null })
    const adapter = install(rec)
    const err = await adapter.patchShotList('p1', 'l1', { title: 'Main shoot' }).then(() => null, e => e)
    expect([err?.message, err?.code]).toEqual(['[supabase] you cannot change this shot list', '42501'])
    expect(await adapter.patchShotList('p1', 'l1', { id: 'l1', created_by: 'u' })).toBeNull()
    expect(rec.sent).toHaveLength(1)
  })

  it('the database\'s refusals keep their code, a taken "Title · vN" in the contract\'s words', async () => {
    const rec = patchClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shot_lists_project_title_version_key"' } })
    const err = await install(rec).patchShotList('p1', 'l1', { title: 'Pickups', version: 1 }).then(() => null, e => e)
    expect([err?.message, err?.code]).toEqual(['[supabase] There is already a shot list with this title and version.', '23505'])
  })
})

describe('Google Drive: every cloud shot-list write is a LOUD read-only stub there', () => {
  it('each shot-list write on supabaseAdapter has a googleDriveAdapter twin that throws readOnly', async () => {
    const WRITE = /^(upsert|patch|replace|reposition|delete|set|archive)(ShotList|ShotListItems|ActiveShotList|Edit)$/
    const writes = Object.keys(supabaseAdapter()).filter(k => WRITE.test(k)).sort()
    // The instrument finds them at all — round 1's two deltas, round 2's
    // reorder and S3b's patch included.
    expect(writes).toEqual([
      'archiveEdit', 'archiveShotList', 'deleteShotListItems', 'patchShotList', 'replaceShotListItems',
      'repositionShotListItems', 'setActiveShotList', 'upsertEdit', 'upsertShotList',
      'upsertShotListItems',
    ])
    const drive = googleDriveAdapter()
    for (const name of writes) {
      // A missing stub would be a TypeError at the call site; a silent one
      // would report a list as changed when nothing changed anywhere.
      expect(typeof drive[name], `googleDriveAdapter has no ${name}`).toBe('function')
      await expect(drive[name]('p1', 'l1', []), name).rejects.toThrow(`[gdrive] ${name}() — Google Drive adapter is read-only`)
    }
  })
})


// ── Bins on the cloud (0091, BC1) ───────────────────────────────────────────
//
// The four reads ride the load (and binRoots is answered []); on a database
// without 0091 the bins read IS the probe — the reads answer [] and every
// bins WRITE refuses with code `bins_unavailable` before any request. Every
// RPC is sent with its exact function and parameter NAMES (a missing name is
// PGRST202, which reads as "0091 is not here"). The refusal map words what
// the database names; the poster upload asks the switch first.

const { resetBinsSchemaState, BINS_REFUSALS, binsRefusalSentence } = await import('./supabaseAdapter')

describe('bins ride the same load (0091)', () => {
  afterEach(() => resetBinsSchemaState())

  it('carries bins, bin files, takes and the company\'s locations through, with binRoots empty', async () => {
    globalThis.__testSupabase = makeClient({
      projects:      { data: { id: 'p1', title: 'Project One' }, error: null },
      bins:          { data: [{ id: 'b1', name: 'Footage' }], error: null },
      bin_files:     { data: [{ id: 'f1', bin_id: 'b1', relative_path: 'A001/T1.mov' }], error: null },
      shot_takes:    { data: [{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1' }], error: null },
      bin_locations: { data: [{ id: 'L1', name: 'Footage NAS' }], error: null },
    })
    resetSupabaseAdapter(); resetBinsSchemaState()
    const bundle = await supabaseAdapter().loadProject('p1')
    expect(bundle.bins).toEqual([{ id: 'b1', name: 'Footage' }])
    expect(bundle.binFiles).toEqual([{ id: 'f1', bin_id: 'b1', relative_path: 'A001/T1.mov' }])
    expect(bundle.shotTakes).toEqual([{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1' }])
    expect(bundle.binLocations).toEqual([{ id: 'L1', name: 'Footage NAS' }])
    expect(bundle.binRoots).toEqual([])
    // No `online` on a cloud row: the provider marks it from the capability object.
    expect('online' in bundle.binFiles[0]).toBe(false)
  })

  it('degrades to empty lists on a client deployed ahead of 0091, and refuses the writes with ONE code', async () => {
    const missing = (t) => ({ data: null, error: { code: '42P01', message: `relation "public.${t}" does not exist` } })
    const rec = recordingClient({
      projects: PROJECT_ROW, bins: missing('bins'), bin_files: missing('bin_files'), shot_takes: missing('shot_takes'), bin_locations: missing('bin_locations'),
    })
    const adapter = install(rec)
    const bundle = await adapter.loadProject('p1')
    expect(bundle.bins).toEqual([]); expect(bundle.binFiles).toEqual([]); expect(bundle.shotTakes).toEqual([]); expect(bundle.binLocations).toEqual([])
    const before = rec.rpcs.length + rec.writes.length
    const writes = {
      createBin: () => adapter.createBin('p1', { name: 'X' }),
      updateBin: () => adapter.updateBin('p1', 'b1', { name: 'Y' }),
      deleteBin: () => adapter.deleteBin('p1', 'b1', {}),
      reorderBins: () => adapter.reorderBins('p1', []),
      addBinFiles: () => adapter.addBinFiles('p1', 'b1', [{}]),
      updateBinFile: () => adapter.updateBinFile('p1', 'f1', { review_flag: 'select' }),
      bulkUpdateBinFiles: () => adapter.bulkUpdateBinFiles('p1', ['f1'], { color: 'red' }),
      moveBinFiles: () => adapter.moveBinFiles('p1', ['f1'], 'b2'),
      copyBinFiles: () => adapter.copyBinFiles('p1', ['f1'], 'b2'),
      removeBinFiles: () => adapter.removeBinFiles('p1', ['f1']),
      restoreBinFiles: () => adapter.restoreBinFiles('p1', [{ id: 'f1' }]),
      assignShotTakes: () => adapter.assignShotTakes('p1', [{ shot_id: 's', bin_file_id: 'f' }]),
      updateShotTake: () => adapter.updateShotTake('p1', 't1', { role: 'alt' }),
      removeShotTakes: () => adapter.removeShotTakes('p1', ['t1']),
      reorderShotTakes: () => adapter.reorderShotTakes('p1', 's', ['t1']),
      replaceShotTakes: () => adapter.replaceShotTakes('p1', ['s'], []),
      createBinLocation: () => adapter.createBinLocation({ name: 'N', unc_path: '\\\\nas\\x' }),
      updateBinLocation: () => adapter.updateBinLocation('L1', { name: 'M' }),
      removeBinLocation: () => adapter.removeBinLocation('L1'),
      setRemoteViewingEnabled: () => adapter.setRemoteViewingEnabled('w1', true),
      postBinFileThumbnail: () => adapter.postBinFileThumbnail('p1', 'f1', btoa('\xff\xd8\xffx')),
    }
    for (const [name, call] of Object.entries(writes)) {
      const err = await call().catch(e => e)
      expect(err, name).toBeInstanceOf(Error)
      expect(err.code, name).toBe('bins_unavailable')
    }
    expect(rec.rpcs.length + rec.writes.length).toBe(before) // not one request
  })

  it('CONTROL: a load REFUSED on bins (42501) does not mark 0091 absent — the write still goes out', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, bins: { data: null, error: { code: '42501', message: 'permission denied for table bins' } } })
    const adapter = install(rec)
    await expect(adapter.loadProject('p1')).rejects.toThrow(/permission denied/)
    const err = await adapter.updateBin('p1', 'b1', { name: 'Y' }).catch(e => e)
    expect(err.code).not.toBe('bins_unavailable')
    expect(rec.writes.some(w => w.table === 'bins')).toBe(true)
  })

  it('a later load that finds the table clears it (a database migrated mid-session)', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, bins: { data: null, error: { code: 'PGRST205', message: 'no table' } } })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    expect((await adapter.updateBin('p1', 'b1', {}).catch(e => e)).code).toBe('bins_unavailable')
    rec.perTable.bins = { data: [], error: null }
    await adapter.loadProject('p1')
    const err = await adapter.updateBin('p1', 'b1', { name: 'Y' }).catch(e => e)
    expect(err.code).not.toBe('bins_unavailable')
  })
})

describe('the bins RPCs send the exact function and parameter names (0091 §10)', () => {
  afterEach(() => resetBinsSchemaState())
  function rpcClient(reply) { return recordingClient({ projects: PROJECT_ROW }, { rpc: reply }) }
  const echo = (name, args) => ({ data: { name, args }, error: null })

  it('deleteBin → delete_bin(p_bin, p_mode, p_target), target NAMED as null in remove mode', async () => {
    const rec = rpcClient(echo); const a = install(rec)
    await a.deleteBin('p1', 'b1', { mode: 'remove' })
    await a.deleteBin('p1', 'b1', { mode: 'move', target: 'b2' })
    expect(rec.rpcs).toStrictEqual([
      { name: 'delete_bin', args: { p_bin: 'b1', p_mode: 'remove', p_target: null } },
      { name: 'delete_bin', args: { p_bin: 'b1', p_mode: 'move', p_target: 'b2' } },
    ])
  })

  it('reorderBins / addBinFiles / moveBinFiles / copyBinFiles / restoreBinFiles', async () => {
    const rec = rpcClient(echo); const a = install(rec)
    await a.reorderBins('p1', [{ id: 'b1', parent_bin_id: null, sort_order: 0 }])
    await a.addBinFiles('p1', 'b1', [{ location_id: 'L1', relative_path: 'A001/T1.mov' }], true)
    await a.addBinFiles('p1', 'b1', [{ location_id: 'L1', relative_path: 'A001/T2.mov' }], false)
    await a.moveBinFiles('p1', ['f1'], 'b2', { f1: 3 })
    await a.moveBinFiles('p1', ['f1'], 'b2')
    await a.copyBinFiles('p1', ['f1'], 'b2')
    await a.restoreBinFiles('p1', [{ id: 'f1', bin_id: 'b1' }])
    expect(rec.rpcs.map(r => [r.name, r.args])).toStrictEqual([
      ['reorder_bins', { p_order: [{ id: 'b1', parent_bin_id: null, sort_order: 0 }] }],
      ['add_bin_files', { p_bin: 'b1', p_items: [{ location_id: 'L1', relative_path: 'A001/T1.mov' }], p_create_sub_bins: true }],
      ['add_bin_files', { p_bin: 'b1', p_items: [{ location_id: 'L1', relative_path: 'A001/T2.mov' }], p_create_sub_bins: false }],
      ['move_bin_files', { p_ids: ['f1'], p_bin: 'b2', p_sort_orders: { f1: 3 } }],
      ['move_bin_files', { p_ids: ['f1'], p_bin: 'b2', p_sort_orders: null }],
      ['copy_bin_files', { p_ids: ['f1'], p_bin: 'b2' }],
      ['restore_bin_files', { p_rows: [{ id: 'f1', bin_id: 'b1' }] }],
    ])
  })

  it('the five take RPCs, every parameter named', async () => {
    const rec = rpcClient(echo); const a = install(rec)
    await a.assignShotTakes('p1', [{ shot_id: 'sh1', bin_file_id: 'f1', role: 'primary' }])
    await a.updateShotTake('p1', 't1', { role: 'alt', position: 2 })
    await a.removeShotTakes('p1', ['t1'])
    await a.reorderShotTakes('p1', 'sh1', ['t2', 't1'])
    await a.replaceShotTakes('p1', ['sh1'], [{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary', position: 0 }])
    expect(rec.rpcs.map(r => [r.name, r.args])).toStrictEqual([
      ['assign_shot_takes', { p_assignments: [{ shot_id: 'sh1', bin_file_id: 'f1', role: 'primary' }] }],
      ['update_shot_take', { p_id: 't1', p_patch: { role: 'alt', position: 2 } }],
      ['remove_shot_takes', { p_ids: ['t1'] }],
      ['reorder_shot_takes', { p_shot: 'sh1', p_ids: ['t2', 't1'] }],
      ['replace_shot_takes', { p_shots: ['sh1'], p_rows: [{ id: 't1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary', position: 0 }] }],
    ])
  })

  it('a missing function (PGRST202) becomes bins_unavailable and marks 0091 absent', async () => {
    const rec = rpcClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })); const a = install(rec)
    const err = await a.assignShotTakes('p1', [{ shot_id: 'sh1', bin_file_id: 'f1' }]).catch(e => e)
    expect(err.code).toBe('bins_unavailable')
    const again = await a.removeShotTakes('p1', ['t1']).catch(e => e)
    expect(again.code).toBe('bins_unavailable')
    expect(rec.rpcs).toHaveLength(1) // the second never left
  })

  it('a refusal keeps its SQLSTATE and the database\'s own words (the RPCs\' RAISEs)', async () => {
    const rec = rpcClient(() => ({ data: null, error: { code: '42501', message: 'you cannot change this project\'s takes' } })); const a = install(rec)
    const err = await a.updateShotTake('p1', 't1', { notes: 'x' }).catch(e => e)
    expect(err.code).toBe('42501')
    expect(err.message).toBe('[supabase] you cannot change this project\'s takes')
    const cycle = rpcClient(() => ({ data: null, error: { code: '23514', message: 'a bin cannot be inside itself' } }))
    const b = install(cycle)
    expect((await b.reorderBins('p1', [{ id: 'b1' }]).catch(e => e)).message).toBe('[supabase] a bin cannot be inside itself')
  })
})

describe('the refusal map: the sentences a person reads (0091)', () => {
  it('names the constraint or policy Postgres names, never the whole text', () => {
    const pg = (code, message) => ({ code, message })
    expect(binsRefusalSentence(pg('23514', 'new row for relation "bin_locations" violates check constraint "bin_locations_unc_path_shape_chk"'))).toBe(BINS_REFUSALS.locationShape)
    expect(binsRefusalSentence(pg('23505', 'duplicate key value violates unique constraint "bin_locations_workspace_unc_key"'))).toBe(BINS_REFUSALS.locationExists)
    expect(binsRefusalSentence(pg('23503', 'update or delete on table "bin_locations" violates foreign key constraint "bin_files_location_fk" on table "bin_files"'))).toBe(BINS_REFUSALS.locationInUse)
    expect(binsRefusalSentence(pg('23514', 'new row for relation "bin_files" violates check constraint "bin_files_relative_path_shape_chk"'))).toBe(BINS_REFUSALS.relativePath)
    expect(binsRefusalSentence(pg('23514', 'new row for relation "bin_files" violates check constraint "bin_files_poster_path_shape_chk"'))).toBe(BINS_REFUSALS.posterPath)
    expect(binsRefusalSentence(pg('23505', 'duplicate key value violates unique constraint "shot_takes_shot_file_key"'))).toBe(BINS_REFUSALS.takeTwice)
    expect(binsRefusalSentence(pg('23503', 'insert or update on table "shot_takes" violates foreign key constraint "shot_takes_shot_fk"'))).toBe(BINS_REFUSALS.takeProject)
    expect(binsRefusalSentence(pg('42501', 'new row violates row-level security policy for table "bins"'))).toBe(BINS_REFUSALS.gate)
    expect(binsRefusalSentence(pg('42501', 'new row violates row-level security policy for table "bin_files"'))).toBe(BINS_REFUSALS.gate)
    expect(binsRefusalSentence(pg('42501', 'new row violates row-level security policy for table "shot_takes"'))).toBe(BINS_REFUSALS.takesGate)
    expect(binsRefusalSentence(pg('42501', 'new row violates row-level security policy for table "bin_locations"'))).toBe(BINS_REFUSALS.locationsGate)
    expect(binsRefusalSentence(pg('42501', 'new row violates row-level security policy "petal_bin_posters_remote_viewing_insert" for table "objects"'))).toBe(BINS_REFUSALS.remoteViewingOff)
    // Anything else keeps Postgres' own words.
    expect(binsRefusalSentence(pg('23505', 'duplicate key value violates unique constraint "bins_pkey"'))).toBeNull()
    expect(binsRefusalSentence(pg('42501', 'permission denied for table bins'))).toBeNull()
    expect(binsRefusalSentence(null)).toBeNull()
  })

  it('a constraint refusal on a write reaches the caller worded, with its SQLSTATE', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { perWrite: {
      bin_locations: { data: null, error: { code: '23514', message: 'new row for relation "bin_locations" violates check constraint "bin_locations_unc_path_shape_chk"' } },
    } })
    const a = install(rec)
    const err = await a.createBinLocation({ name: 'Drive', unc_path: 'Z:\\footage' }).catch(e => e)
    expect(err.code).toBe('23514')
    expect(err.message).toBe(`[supabase] ${BINS_REFUSALS.locationShape}`)
  })

  it('an UPDATE or DELETE that RLS filtered to nothing is the gate sentence, not a quiet success', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { perWrite: {
      bins: { data: [], error: null }, bin_files: { data: [], error: null }, bin_locations: { data: [], error: null }, workspaces: { data: [], error: null },
    } })
    const a = install(rec)
    expect((await a.updateBin('p1', 'b1', { name: 'Y' }).catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.gate}`)
    expect((await a.updateBinFile('p1', 'f1', { color: 'red' }).catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.gate}`)
    expect((await a.removeBinFiles('p1', ['f1']).catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.gate}`)
    expect((await a.updateBinLocation('L1', { name: 'M' }).catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.locationsGate}`)
    expect((await a.removeBinLocation('L1').catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.locationsGate}`)
    expect((await a.setRemoteViewingEnabled('w1', true).catch(e => e)).message).toBe(`[supabase] ${BINS_REFUSALS.switchAdminOnly}`)
  })

  it('updateBinFile sends neither `online` nor the audit columns, and a blank name is refused before any request', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { perWrite: { bin_files: { data: [{ id: 'f1' }], error: null } } })
    const a = install(rec)
    await a.updateBinFile('p1', 'f1', { review_flag: 'select', online: true, added_by: 'x', updated_at: 'y', project_id: 'z' })
    expect(rec.writes[0].row).toStrictEqual({ review_flag: 'select' })
    const err = await a.updateBinFile('p1', 'f1', { display_name: '   ' }).catch(e => e)
    expect(err.code).toBe('invalid')
    expect(rec.writes).toHaveLength(1)
  })
})

describe('the poster upload asks the switch first (B4)', () => {
  afterEach(() => resetBinsSchemaState())
  const JPEG = btoa('\xff\xd8\xff' + 'x'.repeat(16))

  it('with the switch OFF: the sentence, code remote_viewing_off, and no byte moves', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: (name) => ({ data: name === 'rabbit_remote_viewing_enabled' ? false : null, error: null }) })
    const upload = vi.fn(async () => ({ error: null }))
    rec.client.storage = { from: () => ({ upload }) }
    const a = install(rec)
    const err = await a.postBinFileThumbnail('p1', 'f1', JPEG).catch(e => e)
    expect(err.code).toBe('remote_viewing_off')
    expect(err.message).toBe(`[supabase] ${BINS_REFUSALS.remoteViewingOff}`)
    expect(upload).not.toHaveBeenCalled()
    expect(rec.rpcs).toStrictEqual([{ name: 'rabbit_remote_viewing_enabled', args: { p_project: 'p1' } }])
  })

  it('with the switch ON: uploads to projects/{project}/bin_files/{id}/{ts}-poster.jpg and writes poster_path', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, {
      rpc: () => ({ data: true, error: null }),
      perWrite: { bin_files: (entry) => ({ data: [{ id: 'f1', ...entry.row }], error: null }) },
    })
    const upload = vi.fn(async () => ({ error: null }))
    rec.client.storage = { from: (bucket) => { expect(bucket).toBe('rabbit-thumbnails'); return { upload } } }
    const a = install(rec)
    const res = await a.postBinFileThumbnail('p1', 'f1', JPEG)
    expect(res.ok).toBe(true)
    expect(res.poster_path).toMatch(/^projects\/p1\/bin_files\/f1\/\d+-poster\.jpg$/)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(res.poster_path)
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/jpeg', upsert: false })
    expect(rec.writes.find(w => w.table === 'bin_files').row).toStrictEqual({ poster_path: res.poster_path })
  })

  it('a storage refusal that slips past the pre-check reads the same sentence; a non-JPEG never reaches storage', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW }, { rpc: () => ({ data: true, error: null }) })
    const upload = vi.fn(async () => ({ error: { message: 'new row violates row-level security policy "petal_bin_posters_remote_viewing_insert" for table "objects"' } }))
    rec.client.storage = { from: () => ({ upload }) }
    const a = install(rec)
    expect((await a.postBinFileThumbnail('p1', 'f1', JPEG).catch(e => e)).code).toBe('remote_viewing_off')
    expect((await a.postBinFileThumbnail('p1', 'f1', btoa('notajpeg')).catch(e => e)).message).toContain('not a JPEG')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('binFilePosterUrl signs the row\'s key and answers null without one', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW })
    const createSignedUrl = vi.fn(async (key, ttl) => ({ data: { signedUrl: `https://signed/${key}?t=${ttl}` }, error: null }))
    rec.client.storage = { from: () => ({ createSignedUrl }) }
    const a = install(rec)
    expect(await a.binFilePosterUrl('p1', { poster_path: 'projects/p1/bin_files/f1/1-poster.jpg' })).toBe('https://signed/projects/p1/bin_files/f1/1-poster.jpg?t=3600')
    expect(await a.binFilePosterUrl('p1', { id: 'f2' })).toBeNull()
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })
})
