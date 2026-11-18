/** @vitest-environment jsdom */
// =============================================================================
// rateCardReads.test.jsx — F5 item 1 (shared B2): the rate card is read once
// for any number of readers, and an edit reaches every one of them.
//
// The measurement and the pin are the same test: nine useRateCard() readers
// (the Rate Card, Settings and Team Members pages at every launch; the task
// popup, Budget, Scenes, the entity views and the Timeline's versions on
// open) over an adapter that counts every read. Before F5 each reader held
// its own cards, entries and department defaults: `sharedLoadRateCards`
// shared only a card read already in flight, every reader read its card's
// entries and defaults again, and an edit on one reached the others only
// when they remounted.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ perms: null, rabbit: null }))

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => holder.perms }))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => holder.rabbit }))
vi.mock('../../tools/rabbit_v0.1.0/state/rabbitLive', async (importOriginal) => ({
  ...(await importOriginal()),
  useRabbitOnline: () => true,
}))

const { useRateCard, __resetRateCardLoadCache } = await import('./useRateCard')

const tick = () => new Promise((r) => setTimeout(r, 5))

function makeAdapter() {
  const reads = { cards: 0, entries: 0, defaults: 0 }
  const cards = [
    { id: 'card-general', workspace_id: 'ws-1', name: 'General Rate Card', type: 'general', is_default: true },
    { id: 'card-internal', workspace_id: 'ws-1', name: 'Internal Rate Card', type: 'internal', is_default: false },
  ]
  const entries = {
    'card-general': [{ id: 'e-1', rate_card_id: 'card-general', role_label: 'Animator', role_slug: 'animator', wage: 500 }],
    'card-internal': [],
  }
  return {
    reads,
    mode: 'supabase',
    async listRateCards() { reads.cards += 1; await tick(); return cards.map((c) => ({ ...c })) },
    async listRateCardEntries(cardId) { reads.entries += 1; await tick(); return (entries[cardId] || []).map((e) => ({ ...e })) },
    async listDeptDefaults() { reads.defaults += 1; await tick(); return [] },
    async upsertRateCardEntry(entry) {
      await tick()
      const list = entries[entry.rate_card_id] || (entries[entry.rate_card_id] = [])
      const i = list.findIndex((e) => e.id === entry.id)
      if (i >= 0) list[i] = { ...entry }; else list.push({ ...entry })
      return { ...entry }
    },
    async upsertRateCard(card) { return card },
    async deleteRateCardEntry() {},
  }
}

let adapter = null
const seen = new Map()
const api = new Map()
function Reader({ k }) {
  const rc = useRateCard()
  seen.set(k, rc.entries.map((e) => `${e.role_label}:${e.wage}`))
  api.set(k, rc)
  return null
}
const READERS = ['rate-card', 'settings', 'team-members', 'task-popup', 'budget', 'scenes', 'entity-list', 'levels', 'timeline-versions']
function App() { return <>{READERS.map((k) => <Reader key={k} k={k} />)}</> }

beforeEach(() => {
  __resetRateCardLoadCache?.()
  adapter = makeAdapter()
  seen.clear()
  api.clear()
  holder.perms = { ready: true, userId: 'u-admin', workspaceId: 'ws-1', role: 'admin', can: () => true }
  holder.rabbit = { adapterMode: 'supabase', getAdapter: () => adapter, DEFAULT_WORKSPACE_ID: 'ws-default' }
})
afterEach(() => { cleanup(); __resetRateCardLoadCache?.() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const LONG = { timeout: 3000 }
const allSee = (text) => READERS.every((k) => (seen.get(k) || []).includes(text))

describe('the rate card: one read for every reader', () => {
  it('nine readers read the cards once, and the default card\'s entries and defaults once', async () => {
    await act(async () => { render(<App />) })
    await waitFor(() => expect(allSee('Animator:500')).toBe(true), LONG)
    await settle()
    expect(adapter.reads).toEqual({ cards: 1, entries: 1, defaults: 1 })
  })

  it('an edit on one reader is seen by all of them, with no read again', async () => {
    await act(async () => { render(<App />) })
    await waitFor(() => expect(allSee('Animator:500')).toBe(true), LONG)
    await settle()
    const before = { ...adapter.reads }
    await act(async () => { await api.get('rate-card').updateEntry('e-1', { wage: 650 }) })
    await waitFor(() => expect(allSee('Animator:650')).toBe(true), LONG)
    expect(adapter.reads).toEqual(before)
  })
})

describe('the rate card across a change of person and a remount', () => {
  it("a second person over the first never sees the first person's cards, even when the first read lands late", async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const slow = adapter.listRateCards
    let first = true
    adapter.listRateCards = async (...a) => {
      if (first) { first = false; await gate; return [{ id: 'card-first', workspace_id: 'ws-1', name: 'The first person\'s card', type: 'general', is_default: true }] }
      return slow(...a)
    }
    const { rerender } = render(<App />)
    await settle()
    holder.perms = { ...holder.perms, userId: 'u-member', role: 'user' }
    await act(async () => { rerender(<App />) })
    await act(async () => { release() })
    await waitFor(() => expect(allSee('Animator:500')).toBe(true), LONG)
    await settle()
    expect(READERS.every((k) => api.get(k).rateCards.every((c) => c.id !== 'card-first'))).toBe(true)
  })

  it('after every reader has gone, the next reader reads again', async () => {
    const first = render(<App />)
    await waitFor(() => expect(allSee('Animator:500')).toBe(true), LONG)
    first.unmount()
    await settle()
    const cards = adapter.reads.cards
    render(<Reader k="rate-card" />)
    await waitFor(() => expect((seen.get('rate-card') || []).includes('Animator:500')).toBe(true), LONG)
    expect(adapter.reads.cards).toBe(cards + 1)
  })
})

describe('review round 1: a reader that opens later reads the card again', () => {
  it('a Budget opened after the rates changed on the server shows them, read once for every reader', async () => {
    const first = render(<Reader k="rate-card" />)
    await waitFor(() => expect((seen.get('rate-card') || []).includes('Animator:500')).toBe(true), LONG)
    // Another window changes the rate; this one's pages stay mounted.
    await adapter.upsertRateCardEntry({ id: 'e-1', rate_card_id: 'card-general', role_label: 'Animator', role_slug: 'animator', wage: 650 })
    const reads = { ...adapter.reads }
    const later = Date.now() + 5000
    const now = vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      render(<Reader k="budget" />)
      await waitFor(() => expect((seen.get('budget') || []).includes('Animator:650')).toBe(true), LONG)
      await waitFor(() => expect((seen.get('rate-card') || []).includes('Animator:650')).toBe(true), LONG)
      expect(adapter.reads.entries).toBe(reads.entries + 1)
    } finally {
      now.mockRestore()
      first.unmount()
    }
  })
})
