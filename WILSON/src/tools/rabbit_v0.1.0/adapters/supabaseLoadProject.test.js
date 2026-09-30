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

const { supabaseAdapter, resetSupabaseAdapter } = await import('./supabaseAdapter')

beforeEach(() => {
  client = makeClient({
    projects: { data: { id: 'p1', title: 'Project One' }, error: null },
  })
  globalThis.__testSupabase = client
  resetSupabaseAdapter()
})

afterEach(() => {
  resetSupabaseAdapter()
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
// exactly as makeClient's do; a write resolves to `perWrite[table]` when given,
// else echoes the row back as the stored row.
function recordingClient(perTable = {}, { perWrite = {}, rpc = null } = {}) {
  const writes = []
  const rpcs = []
  const c = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table) => {
      let written = null
      const record = (op) => (row) => { written = row; writes.push({ table, op, row }); return b }
      const b = {
        select: () => b, eq: () => b, order: () => b, single: () => b,
        upsert: record('upsert'), update: record('update'), insert: record('insert'),
        then: (resolve, reject) => {
          const result = written === null
            ? (table in perTable ? perTable[table] : { data: [], error: null })
            : (table in perWrite ? perWrite[table] : { data: { ...written }, error: null })
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
  return { client: c, writes, rpcs, perTable }
}

function install(rec) {
  globalThis.__testSupabase = rec.client
  resetSupabaseAdapter()
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

  it('resetSupabaseAdapter clears the absent flag', async () => {
    const rec = recordingClient({ projects: PROJECT_ROW, shot_lists: MISSING_42P01('shot_lists') })
    const adapter = install(rec)
    await adapter.loadProject('p1')
    resetSupabaseAdapter()
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
