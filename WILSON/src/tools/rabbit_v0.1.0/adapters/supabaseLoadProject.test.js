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
