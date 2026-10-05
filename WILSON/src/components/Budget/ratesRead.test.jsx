/** @vitest-environment jsdom */
// =============================================================================
// ratesRead.test.jsx — post-overhaul S5c: the two rate hooks say when their
// rates are READ, not only "not loading". A hook's first render is "not
// loading" before any read has started, and the rate card's is again for a
// render between its two reads; the overrides are stale after an open writes
// a version's rates (the provider's rateOverridesEpoch) until they are read
// again. The Budget's versions block must not call a bid unsaved — or save
// one — off rates still on their way (budget/BidVersions.jsx's
// ratesPendingFrom reads these).
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

const held = vi.hoisted(() => ({ rabbit: null, gates: {} }))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const adapter = {
  listRateCards: vi.fn(async () => { await held.gates.cards?.promise; return [{ id: 'rc1', workspace_id: 'w1', is_default: true, type: 'general', name: 'General' }] }),
  listRateCardEntries: vi.fn(async () => { await held.gates.entries?.promise; return [{ id: 'e1', rate_card_id: 'rc1', role_slug: 'anim', day_rate: 500 }] }),
  listDeptDefaults: vi.fn(async () => []),
  listProjectRateOverrides: vi.fn(async () => { await held.gates.overrides?.promise; return [] }),
}
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => held.rabbit }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => ({ ready: true, workspaceId: 'w1' }) }))
// The module graph reaches the cloud client at import; CI has no .env.local,
// and createClient refuses a missing URL (CI run 37337162905 — this file's
// first push). The Budget's other tests stub it the same way.
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const { useRateCard } = await import('../RateCard/useRateCard')
const { useProjectRateOverrides } = await import('./useProjectRateOverrides')
const { ratesPendingFrom } = await import('../../tools/rabbit_v0.1.0/views/budget/BidVersions')

afterEach(() => { cleanup(); held.gates = {} })

describe('useRateCard: settled', () => {
  it('not on the first render, nor while the active card\'s entries are on their way; then settled', async () => {
    held.gates.entries = deferred()
    held.rabbit = { getAdapter: () => adapter, adapterMode: 'fixtures', adapterStatus: { online: true }, DEFAULT_WORKSPACE_ID: 'w0' }
    const { result } = renderHook(() => useRateCard())
    // Mounted (renderHook's act has run the effects, so a read is under way):
    // not read.
    expect(result.current.settled).toBe(false)
    await waitFor(() => expect(result.current.activeRateCardId).toBe('rc1'))
    expect(result.current.settled).toBe(false)
    await act(async () => { held.gates.entries.resolve() })
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.entries).toHaveLength(1)
  })
})

describe('useProjectRateOverrides: loadedEpoch', () => {
  it('null until the first read lands, then the epoch it was read at; after a bump, the old epoch until the new read lands', async () => {
    held.gates.overrides = deferred()
    held.rabbit = { getAdapter: () => adapter, project: { id: 'p1' }, adapterMode: 'fixtures', adapterStatus: { online: true }, rateOverridesEpoch: 0 }
    const { result, rerender } = renderHook(() => useProjectRateOverrides())
    expect(result.current.loadedEpoch).toBeNull()
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 0 })).toBe('Reading the project’s rates…')
    await act(async () => { held.gates.overrides.resolve() })
    await waitFor(() => expect(result.current.loadedEpoch).toBe(0))
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 0 })).toBeNull()
    // An open wrote a version's rates: the provider bumps the epoch.
    held.gates.overrides = deferred()
    held.rabbit = { ...held.rabbit, rateOverridesEpoch: 1 }
    rerender()
    expect(result.current.loadedEpoch).toBe(0)
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 1 })).toBe('Reading the project’s rates…')
    await act(async () => { held.gates.overrides.resolve() })
    await waitFor(() => expect(result.current.loadedEpoch).toBe(1))
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 1 })).toBeNull()
  })
  it('S5c review round 1 (R1-07): a failed read is tried again, and the rates are read once the backend answers', async () => {
    let fail = false
    const flaky = { listProjectRateOverrides: vi.fn(async () => { if (fail) throw new Error('network down'); return [] }) }
    held.rabbit = { getAdapter: () => flaky, project: { id: 'p1' }, adapterMode: 'fixtures', adapterStatus: { online: true }, rateOverridesEpoch: 0 }
    const { result, rerender } = renderHook(() => useProjectRateOverrides())
    await waitFor(() => expect(result.current.loadedEpoch).toBe(0))
    // An open wrote a rate (the epoch moves) and the re-read fails once.
    fail = true
    held.rabbit = { ...held.rabbit, rateOverridesEpoch: 1 }
    rerender()
    await waitFor(() => expect(result.current.error).toBe('network down'))
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 1 })).toBe('The project’s rates could not be read: network down')
    fail = false // the network is back; nothing else reads again
    await waitFor(() => expect(result.current.loadedEpoch).toBe(1), { timeout: 4000 })
    expect(result.current.error).toBeNull()
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: result.current, epoch: 1 })).toBeNull()
  })
  it('a backend with no project rates has its empty list at every epoch', async () => {
    const bare = { listRateCards: adapter.listRateCards }
    held.rabbit = { getAdapter: () => bare, project: { id: 'p1' }, adapterMode: 'fixtures', adapterStatus: { online: true }, rateOverridesEpoch: 3 }
    const { result } = renderHook(() => useProjectRateOverrides())
    await waitFor(() => expect(result.current.loadedEpoch).toBe(3))
  })
})

describe('ratesPendingFrom', () => {
  it('says why, the rate card first; null once both are read; a stub that does not report is read', () => {
    expect(ratesPendingFrom({ rateCard: { settled: false }, rateOverrides: { loadedEpoch: 0 }, epoch: 0 })).toBe('Reading the rate card…')
    expect(ratesPendingFrom({ rateCard: { settled: false, error: 'offline' }, rateOverrides: {}, epoch: 0 })).toBe('The rate card could not be read: offline')
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: { loading: true, loadedEpoch: 0 }, epoch: 0 })).toBe('Reading the project’s rates…')
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: { loadedEpoch: null, error: 'denied' }, epoch: 0 })).toBe('The project’s rates could not be read: denied')
    expect(ratesPendingFrom({ rateCard: { settled: true }, rateOverrides: { loading: false, loadedEpoch: 2 }, epoch: 2 })).toBeNull()
    expect(ratesPendingFrom({ rateCard: { entries: [] }, rateOverrides: { overrides: [] }, epoch: 5 })).toBeNull()
  })
})
