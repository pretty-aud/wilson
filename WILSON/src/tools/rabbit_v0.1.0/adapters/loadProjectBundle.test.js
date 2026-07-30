// =============================================================================
// loadProjectBundle.test.js — Session 17 (§6 #47).
//
// Milestones were silently dropped on every project load: both
// localServerAdapter.loadProject and googleDriveAdapter.loadProject return an
// EXPLICIT list of named keys, and neither named `milestones`. Because
// setActiveProject/reloadActiveProject do `setBundle({ ...EMPTY_BUNDLE,
// ...next })`, a key the adapter omits is not merely missing — it is RESET to
// the empty array. So every milestone a user created reverted to nothing on
// the next reload, project switch or realtime refetch.
//
// The single-key fix is one line per adapter. This file exists for the CLASS
// of bug rather than the instance: an explicit key list that must stay in
// step with a bundle shape defined in a different file is a standing trap,
// and nothing anywhere held the two together. The coverage probe below fails
// on the NEXT omission, not just this one.
//
// Honest limitation, in the projectAttachments.test.js tradition: the
// EXPECTED_KEYS list mirrors EMPTY_BUNDLE from state/RabbitProvider.jsx,
// which does not export it (importing the provider would pull React and a
// live Supabase client into a pure-module test). If EMPTY_BUNDLE gains a
// collection key and this list is not updated, these tests keep passing
// while the adapters regress. RabbitProvider carries a pointer back here.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { localServerAdapter } from './localServerAdapter'

// Mirror of EMPTY_BUNDLE's collection keys (RabbitProvider.jsx:76-97),
// minus `project` (an object, not a collection).
//
// `expenses` is deliberately ABSENT from this list even though EMPTY_BUNDLE
// has it: expenses are read through useExpenses -> adapter.listExpenses and
// never off bundle.expenses, so requiring it of loadProject would be dead
// weight. That exclusion is a decision, not an oversight.
const EXPECTED_KEYS = [
  'phases', 'assets', 'tasks', 'dependencies', 'taskLinks', 'files',
  'assetVersions', 'comments', 'ingestionRuns', 'teamAssignments',
  'managedFiles', 'budgetVersions', 'projectTeam',
  'scenes', 'shots', 'levels', 'experiences', 'milestones',
]

/** A server bundle with one identifiable row in every collection. */
function serverBundle() {
  const b = { project: { id: 'p1', title: 'Project One' } }
  for (const k of EXPECTED_KEYS) b[k] = [{ id: `${k}-1` }]
  return b
}

function stubFetch(payload) {
  const res = {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  }
  globalThis.fetch = vi.fn(async () => res)
}

afterEach(() => { vi.restoreAllMocks() })

describe('localServerAdapter.loadProject — bundle key coverage', () => {
  it('returns every collection the bundle shape declares', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    const missing = EXPECTED_KEYS.filter((k) => bundle[k] === undefined)
    expect(missing).toEqual([])
  })

  it('carries milestones through instead of dropping them (#47)', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    // The regression: this was `undefined`, which the EMPTY_BUNDLE spread
    // then turned into [] — indistinguishable from "the user has none".
    expect(bundle.milestones).toEqual([{ id: 'milestones-1' }])
  })

  it('defaults every collection to an array when the server omits it', async () => {
    // A bundle written before a collection existed has no such key. Every
    // slot must still arrive as [] so consumers can map over it unguarded.
    stubFetch({ project: { id: 'p1' } })
    const bundle = await localServerAdapter().loadProject('p1')
    for (const k of EXPECTED_KEYS) {
      expect(Array.isArray(bundle[k]), `${k} should default to []`).toBe(true)
      expect(bundle[k]).toEqual([])
    }
  })

  it('preserves the project row itself', async () => {
    stubFetch(serverBundle())
    const bundle = await localServerAdapter().loadProject('p1')
    expect(bundle.project).toEqual({ id: 'p1', title: 'Project One' })
  })
})
