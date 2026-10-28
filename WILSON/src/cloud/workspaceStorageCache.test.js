// =============================================================================
// workspaceStorageCache.test.js — Session 37.
//
// The storage-choice cache that feeds uploadFile's provider decision
// (getWorkspaceStorageCached). The behaviours that matter:
//   * a failed read THROWS and caches NOTHING — refusing an upload beats
//     guessing 'petal' and silently routing media to a store the customer
//     moved away from;
//   * null (no row) IS cached — "never configured" is an answer (Petal
//     cloud, today's behaviour), not an error;
//   * saves warm the cache, so an admin's change is live in their own
//     session immediately;
//   * clearWorkspaceStorageCache forgets — sign-out and workspace switches
//     must not leak one tenant's choice into the next session.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The module under test imports the shared client; fake the two query shapes
// it uses (select().maybeSingle() chains for fetch, insert/update for save).
const state = { fetchResult: null, fetchError: null, reads: 0, gate: null }

vi.mock('./auth/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        // The answer is the one AT THE TIME OF ASKING; `gate` holds it in flight.
        maybeSingle: async () => {
          state.reads += 1
          const answer = { data: state.fetchResult, error: state.fetchError }
          if (state.gate) await state.gate
          return answer
        },
      }),
      insert: (row) => ({
        select: () => ({
          maybeSingle: async () => ({ data: { ...row }, error: null }),
        }),
      }),
      update: (patch) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: { workspace_id: 'w1', ...patch }, error: null }),
          }),
        }),
      }),
    }),
  },
}))

import {
  fetchWorkspaceStorage,
  saveWorkspaceStorage,
  getWorkspaceStorageCached,
  clearWorkspaceStorageCache,
  peekWorkspaceStorageCached,
} from './workspaceStorage'

beforeEach(() => {
  clearWorkspaceStorageCache()
  state.fetchResult = null
  state.fetchError = null
  state.gate = null
})

describe('getWorkspaceStorageCached', () => {
  it('🚨 a read answered after a sign-out never fills the slot, and its waiter asks again for the new identity (P1, review round 2)', async () => {
    const rowA = { workspace_id: 'wA', mode: 'byos', provider: 's3' }
    const rowB = { workspace_id: 'wB', mode: 'central', provider: 'petal' }
    let release
    state.fetchResult = rowA
    state.gate = new Promise((r) => { release = r })
    const waiter = getWorkspaceStorageCached()          // asked under A
    const direct = fetchWorkspaceStorage()              // App.jsx's own read, under A
    clearWorkspaceStorageCache()                        // A signs out; B signs in
    state.fetchResult = rowB
    state.gate = null
    release()
    await direct
    await expect(waiter).resolves.toEqual(rowB)         // re-asked, for B
    expect(peekWorkspaceStorageCached()).toEqual(rowB)  // never A's
  })

  it('CONTROL: a read with no sign-out between fills the slot as before', async () => {
    const rowA = { workspace_id: 'wA', mode: 'byos', provider: 's3' }
    state.fetchResult = rowA
    await fetchWorkspaceStorage()
    expect(peekWorkspaceStorageCached()).toEqual(rowA)
  })

  it('panels that ask at once share ONE read (P1, review round 1, finding 6); a failed one is retried by the next call', async () => {
    state.fetchResult = { workspace_id: 'w1', mode: 'byos', provider: 'network' }
    state.reads = 0
    await Promise.all([getWorkspaceStorageCached(), getWorkspaceStorageCached(), getWorkspaceStorageCached()])
    expect(state.reads).toBe(1)
    clearWorkspaceStorageCache()
    state.fetchError = { message: 'offline' }
    await expect(getWorkspaceStorageCached()).rejects.toThrow(/offline/)
    state.fetchError = null
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ provider: 'network' })
    expect(state.reads).toBe(3)
  })

  it('fetches once, then serves from the cache', async () => {
    state.fetchResult = { workspace_id: 'w1', mode: 'byos', provider: 's3' }
    const first = await getWorkspaceStorageCached()
    expect(first.provider).toBe('s3')
    // A later fetch failure is invisible while the cache is warm.
    state.fetchError = { message: 'network down' }
    await expect(getWorkspaceStorageCached()).resolves.toEqual(first)
  })

  it('caches NULL — "never configured" is an answer, not an error', async () => {
    state.fetchResult = null
    await expect(getWorkspaceStorageCached()).resolves.toBeNull()
    state.fetchError = { message: 'network down' }
    await expect(getWorkspaceStorageCached()).resolves.toBeNull()
  })

  it('a failed read throws and caches nothing — the next call retries', async () => {
    state.fetchError = { message: 'RLS says no' }
    await expect(getWorkspaceStorageCached()).rejects.toThrow(/workspace storage read failed/)
    state.fetchError = null
    state.fetchResult = { workspace_id: 'w1', mode: 'central', provider: 'petal' }
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ mode: 'central' })
  })

  it('is warmed by fetchWorkspaceStorage (App.jsx\'s sign-in read)', async () => {
    state.fetchResult = { workspace_id: 'w1', mode: 'byos', provider: 'network' }
    await fetchWorkspaceStorage()
    state.fetchError = { message: 'network down' }
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ provider: 'network' })
  })

  it('is warmed by saves, on both the insert and update paths', async () => {
    await saveWorkspaceStorage({ workspaceId: 'w1', exists: false, patch: { mode: 'byos', provider: 's3', provider_config: { bucket: 'b' } } })
    state.fetchError = { message: 'network down' }
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ provider: 's3' })

    await saveWorkspaceStorage({ workspaceId: 'w1', exists: true, patch: { mode: 'central' } })
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ mode: 'central' })
  })

  it('clearWorkspaceStorageCache forgets — the next session re-reads', async () => {
    state.fetchResult = { workspace_id: 'w1', mode: 'byos', provider: 's3' }
    await getWorkspaceStorageCached()
    clearWorkspaceStorageCache()
    state.fetchResult = { workspace_id: 'w2', mode: 'central', provider: 'petal' }
    await expect(getWorkspaceStorageCached()).resolves.toMatchObject({ workspace_id: 'w2' })
  })
})
