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
