// =============================================================================
// useRateCard — the shared auto-create guard (Session 21).
//
// Eight independent useRateCard() consumers mount with no provider or cache
// between them, and each runs its own load. Before this guard, mounts that
// overlapped all observed zero cards and all created a card. The local
// Electron store banked the result: FOUR 'Internal Rate Card' rows for one
// workspace, created inside 53 ms of each other on 2026-04-11.
//
// Cloud mode hid it only because the create FAILED there — rate_cards had no
// `type` column, so every insert died with PGRST204. Migration 0032 removes
// that accidental brake, which is what makes these tests load-bearing rather
// than theoretical.
//
// PROVE THE TEST BITES: delete the `inFlightLoads` dedupe in
// sharedLoadRateCards and "collapses concurrent mounts onto a single create"
// fails with 4 created cards instead of 2.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The module imports a React context provider and the adapter registry; neither
// is under test and RabbitProvider drags in the Electron bridge. Stub both.
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => null,
}))
vi.mock('../../tools/rabbit_v0.1.0/adapters', () => ({
  adapterSupportsWrites: (mode) => mode !== 'googledrive',
}))

const { sharedLoadRateCards, __resetRateCardLoadCache } = await import('./useRateCard')

/** An adapter whose list is empty and whose writes are recorded. */
function makeAdapter({ mode = 'supabase', existing = [], listDelayMs = 0 } = {}) {
  const created = []
  return {
    mode,
    created,
    listCalls: { n: 0 },
    async listRateCards() {
      this.listCalls.n += 1
      // A real network read is not instantaneous, and the race only exists
      // because a second mount lands inside that window.
      if (listDelayMs) await new Promise(r => setTimeout(r, listDelayMs))
      return existing.slice()
    },
    async upsertRateCard(card) {
      created.push(card)
      return { ...card }
    },
  }
}

describe('sharedLoadRateCards', () => {
  beforeEach(() => { __resetRateCardLoadCache() })

  it('creates the General/Internal pair when a workspace has none', async () => {
    const adapter = makeAdapter()
    const { cards, softError } = await sharedLoadRateCards(adapter, 'ws-1')

    expect(softError).toBeNull()
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.type)).toEqual(['general', 'internal'])
    expect(cards.find(c => c.type === 'general').is_default).toBe(true)
  })

  it('collapses concurrent mounts onto a single create', async () => {
    // Eight consumers, mounted together, as they are on a cold start.
    const adapter = makeAdapter({ listDelayMs: 5 })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => sharedLoadRateCards(adapter, 'ws-1')),
    )

    // The whole point: one create, not eight.
    expect(adapter.created).toHaveLength(2)
    expect(adapter.listCalls.n).toBe(1)
    // And every caller still gets the cards — dedupe must not starve anyone.
    for (const r of results) {
      expect(r.cards).toHaveLength(2)
    }
  })

  it('does not share across different workspaces', async () => {
    const adapter = makeAdapter({ listDelayMs: 5 })
    await Promise.all([
      sharedLoadRateCards(adapter, 'ws-1'),
      sharedLoadRateCards(adapter, 'ws-2'),
    ])
    // Two workspaces, two pairs — collapsing these would be a tenancy bug.
    expect(adapter.created).toHaveLength(4)
    expect(adapter.listCalls.n).toBe(2)
  })

  it('clears the in-flight entry after a rejection so the next mount retries', async () => {
    const adapter = makeAdapter()
    adapter.listRateCards = async () => { throw new Error('network down') }

    await expect(sharedLoadRateCards(adapter, 'ws-1')).rejects.toThrow('network down')

    // A cached rejection would wedge every later mount with no way to recover.
    adapter.listRateCards = async () => []
    const { cards } = await sharedLoadRateCards(adapter, 'ws-1')
    expect(cards).toHaveLength(2)
  })

  it('adds only the missing internal card when a general one already exists', async () => {
    const adapter = makeAdapter({
      existing: [{ id: 'g1', type: 'general', name: 'General Rate Card' }],
    })
    const { cards } = await sharedLoadRateCards(adapter, 'ws-1')

    expect(adapter.created).toHaveLength(1)
    expect(adapter.created[0].type).toBe('internal')
    expect(cards).toHaveLength(2)
  })

  it('tags a legacy untyped card as general rather than creating a duplicate', async () => {
    const adapter = makeAdapter({
      existing: [{ id: 'old', name: 'Rate Card' }],  // pre-`type` row
    })
    const { cards } = await sharedLoadRateCards(adapter, 'ws-1')

    expect(cards.find(c => c.id === 'old').type).toBe('general')
    // One write to tag it, one to add the missing internal card.
    expect(adapter.created.map(c => c.type)).toEqual(['general', 'internal'])
  })

  it('never writes through a read-only adapter', async () => {
    // Google Drive is read-only in v0.1. Session 17 (§6 #49): calling the
    // throwing stub here left a permanent red banner, which made an empty
    // read look like a failure instead of an empty page.
    const adapter = makeAdapter({ mode: 'googledrive' })
    const { cards, softError } = await sharedLoadRateCards(adapter, 'ws-1')

    expect(adapter.created).toHaveLength(0)
    expect(softError).toBeNull()
    expect(cards).toEqual([])
  })
})
