// ============================================================
// useRateCard — workspace-scoped rate card hook
// ============================================================
//
// The Rate Card module is workspace-level, not project-scoped, so
// it lives outside the RABBIT project bundle and consumes the
// adapter directly via `getAdapter()` from RabbitProvider. This
// hook owns the entire rate card editor lifecycle:
//
//   - On mount: list rate cards for the workspace; if none, lazily
//     create a "Default Rate Card" so the editor always has a row.
//   - Track entries for the active rate card.
//   - Optimistic CRUD on entries (add / update / delete) with
//     rollback on adapter error.
//   - bulkUpsertEntries() — used by the importer pipeline.
//
// The shape returned matches the Session 2 schema fields:
//   { id, rate_card_id, role_label, role_slug, region, project_size,
//     day_rate, week_rate, month_rate, currency, source_row }

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

function makeSlug(label) {
  return String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function useRateCard() {
  const rabbit = useRabbit()
  const getAdapter = rabbit?.getAdapter
  const workspaceId = rabbit?.DEFAULT_WORKSPACE_ID
  const adapterMode = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [rateCards, setRateCards] = useState([])
  const [activeRateCardId, setActiveRateCardId] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Load rate cards on mount + on adapter mode change ──
  const loadRateCards = useCallback(async () => {
    if (!getAdapter || !workspaceId) return
    const adapter = getAdapter()
    if (!adapter) return
    setLoading(true)
    setError(null)
    try {
      let cards = await adapter.listRateCards(workspaceId)
      if (!Array.isArray(cards)) cards = []
      // Auto-create a default rate card if none exist.
      if (cards.length === 0) {
        try {
          const created = await adapter.upsertRateCard({
            id: uuidv4(),
            workspace_id: workspaceId,
            name: 'Default Rate Card',
            is_default: true,
          })
          cards = [created]
        } catch (err) {
          // Read-only adapters (Drive) will throw NotImplementedError
          // here. Surface the failure but don't crash the page.
          if (mountedRef.current) setError(err.message || String(err))
        }
      }
      if (!mountedRef.current) return
      setRateCards(cards)
      // Pick the default card, or the first one.
      const next = cards.find(c => c.is_default) || cards[0] || null
      setActiveRateCardId(next ? next.id : null)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, workspaceId])

  // Reload whenever the active adapter changes underneath us.
  useEffect(() => {
    loadRateCards()
  }, [loadRateCards, adapterMode, adapterStatus?.online])

  // ── Load entries whenever active card changes ──
  useEffect(() => {
    if (!activeRateCardId || !getAdapter) {
      setEntries([])
      return
    }
    const adapter = getAdapter()
    if (!adapter) return
    setLoading(true)
    adapter.listRateCardEntries(activeRateCardId)
      .then(rows => {
        if (!mountedRef.current) return
        setEntries(Array.isArray(rows) ? rows : [])
      })
      .catch(err => {
        if (mountedRef.current) setError(err.message || String(err))
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [activeRateCardId, getAdapter])

  // ── Helpers ──
  const normalizeEntry = useCallback((draft) => {
    const role_label = draft.role_label || draft.role || ''
    const role_slug = draft.role_slug || makeSlug(role_label)
    return {
      id: draft.id || uuidv4(),
      rate_card_id: activeRateCardId,
      role_label,
      role_slug,
      region: draft.region || null,
      project_size: draft.project_size || null,
      day_rate: draft.day_rate ?? null,
      week_rate: draft.week_rate ?? null,
      month_rate: draft.month_rate ?? null,
      currency: draft.currency || 'USD',
      source_row: draft.source_row ?? null,
    }
  }, [activeRateCardId])

  // ── Mutations (optimistic) ──
  const addEntry = useCallback(async (draft) => {
    if (!activeRateCardId || !getAdapter) return null
    const adapter = getAdapter()
    if (!adapter) return null
    const entry = normalizeEntry(draft)
    setEntries(prev => [...prev, entry])
    try {
      const saved = await adapter.upsertRateCardEntry(entry)
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...entry, ...saved } : e))
      return saved
    } catch (err) {
      setEntries(prev => prev.filter(e => e.id !== entry.id))
      setError(err.message || String(err))
      throw err
    }
  }, [activeRateCardId, getAdapter, normalizeEntry])

  const updateEntry = useCallback(async (id, patch) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter) return
    const snapshot = entries
    const next = entries.map(e => e.id === id ? { ...e, ...patch } : e)
    setEntries(next)
    const merged = next.find(e => e.id === id)
    try {
      const saved = await adapter.upsertRateCardEntry(merged)
      setEntries(prev => prev.map(e => e.id === id ? { ...merged, ...saved } : e))
      return saved
    } catch (err) {
      setEntries(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [entries, getAdapter])

  const deleteEntry = useCallback(async (id) => {
    if (!getAdapter || !activeRateCardId) return
    const adapter = getAdapter()
    if (!adapter) return
    const snapshot = entries
    setEntries(prev => prev.filter(e => e.id !== id))
    try {
      await adapter.deleteRateCardEntry(id, activeRateCardId)
    } catch (err) {
      setEntries(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [entries, getAdapter, activeRateCardId])

  // ── Bulk upsert (used by importers) ──
  // Accepts an array of partial entries; returns the resulting set.
  // Strategy: walk one-at-a-time so we can surface partial errors
  // and update the UI as each row commits.
  const bulkUpsertEntries = useCallback(async (drafts) => {
    if (!getAdapter || !activeRateCardId) return []
    const adapter = getAdapter()
    if (!adapter) return []
    const results = []
    for (const d of drafts) {
      try {
        const entry = normalizeEntry(d)
        const saved = await adapter.upsertRateCardEntry(entry)
        results.push({ ok: true, entry: saved || entry })
        setEntries(prev => {
          const idx = prev.findIndex(e => e.id === entry.id || e.role_slug === entry.role_slug)
          if (idx === -1) return [...prev, saved || entry]
          const next = prev.slice()
          next[idx] = { ...next[idx], ...(saved || entry) }
          return next
        })
      } catch (err) {
        results.push({ ok: false, error: err.message || String(err), draft: d })
      }
    }
    return results
  }, [getAdapter, activeRateCardId, normalizeEntry])

  return {
    workspaceId,
    rateCards,
    activeRateCardId,
    setActiveRateCardId,
    entries,
    loading,
    error,
    reload: loadRateCards,
    addEntry,
    updateEntry,
    deleteEntry,
    bulkUpsertEntries,
    makeSlug,
  }
}
