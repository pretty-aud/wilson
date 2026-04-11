// ============================================================
// useRateCard — workspace-scoped rate card hook
// ============================================================
//
// Manages two types of rate cards:
//
//   1. General Rate Card — company standard day rates per role.
//      Used for estimating/bidding before a specific person is
//      assigned. Roles are grouped by department.
//
//   2. Internal Rate Card — individual day rates per team member.
//      Auto-populated from the team members database. Each member
//      has their own wage/burden/overhead breakdown.
//
// Entry fields:
//   wage         — daily wage/salary cost
//   burden       — insurance, office overhead (% or fixed $)
//   burden_type  — 'percent' | 'fixed'
//   overhead     — software licenses, tools (% or fixed $)
//   overhead_type — 'percent' | 'fixed'
//   department   — department grouping
//   member_id    — team member id (internal rate card only)
//
// Department defaults:
//   Per-rate-card, per-department fallback burden_pct and overhead_pct.
//   When an entry has null burden/overhead, the dept default is used.
//
// Backward compatibility:
//   Entries with day_rate but no wage are migrated on read:
//   wage = day_rate. The computed total replaces day_rate for consumers.

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

export function makeSlug(label) {
  return String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// ── Budget tiers (project_size) ──
export const BUDGET_TIERS = [
  { value: 'tier_1', label: 'Tier 1 — Indie' },
  { value: 'tier_2', label: 'Tier 2 — Mid-Budget' },
  { value: 'tier_3', label: 'Tier 3 — Studio' },
  { value: 'tier_4', label: 'Tier 4 — AAA / Tentpole' },
]

// ── Compute entry total ──
// Returns { burden_amount, overhead_amount, total } for an entry given dept defaults.
export function computeEntryTotal(entry, deptDefaults = []) {
  const wage = Number(entry?.wage ?? entry?.day_rate ?? 0) || 0
  if (wage === 0) return { wage: 0, burden_amount: 0, overhead_amount: 0, total: 0 }

  const dept = deptDefaults.find(d => d.department === entry?.department) || {}

  let burden_amount = 0
  if (entry?.burden != null && entry.burden !== '') {
    if (entry.burden_type === 'fixed') {
      burden_amount = Number(entry.burden) || 0
    } else {
      // percent of wage
      burden_amount = wage * (Number(entry.burden) / 100)
    }
  } else if (dept.burden_pct != null) {
    burden_amount = wage * (Number(dept.burden_pct) / 100)
  }

  let overhead_amount = 0
  if (entry?.overhead != null && entry.overhead !== '') {
    if (entry.overhead_type === 'fixed') {
      overhead_amount = Number(entry.overhead) || 0
    } else {
      overhead_amount = wage * (Number(entry.overhead) / 100)
    }
  } else if (dept.overhead_pct != null) {
    overhead_amount = wage * (Number(dept.overhead_pct) / 100)
  }

  return {
    wage,
    burden_amount: Math.round(burden_amount * 100) / 100,
    overhead_amount: Math.round(overhead_amount * 100) / 100,
    total: Math.round((wage + burden_amount + overhead_amount) * 100) / 100,
  }
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
  const [deptDefaults, setDeptDefaults] = useState([])
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
      // Auto-create General + Internal rate cards if none exist.
      if (cards.length === 0) {
        try {
          const generalCard = await adapter.upsertRateCard({
            id: uuidv4(),
            workspace_id: workspaceId,
            name: 'General Rate Card',
            type: 'general',
            is_default: true,
          })
          const internalCard = await adapter.upsertRateCard({
            id: uuidv4(),
            workspace_id: workspaceId,
            name: 'Internal Rate Card',
            type: 'internal',
            is_default: false,
          })
          cards = [generalCard, internalCard].filter(Boolean)
        } catch (err) {
          if (mountedRef.current) setError(err.message || String(err))
        }
      } else {
        // Ensure both types exist (migration from old single rate card)
        const hasGeneral = cards.some(c => c.type === 'general')
        const hasInternal = cards.some(c => c.type === 'internal')
        // Tag untyped cards as general
        if (!hasGeneral) {
          for (const c of cards) {
            if (!c.type) {
              c.type = 'general'
              try { await adapter.upsertRateCard(c) } catch {}
            }
          }
        }
        if (!hasInternal) {
          try {
            const internalCard = await adapter.upsertRateCard({
              id: uuidv4(),
              workspace_id: workspaceId,
              name: 'Internal Rate Card',
              type: 'internal',
              is_default: false,
            })
            if (internalCard) cards.push(internalCard)
          } catch {}
        }
      }
      if (!mountedRef.current) return
      setRateCards(cards)
      // Pick the default (general) card, or the first one.
      const next = cards.find(c => c.is_default) || cards.find(c => c.type === 'general') || cards[0] || null
      setActiveRateCardId(next ? next.id : null)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, workspaceId])

  useEffect(() => {
    loadRateCards()
  }, [loadRateCards, adapterMode, adapterStatus?.online])

  // ── Load entries + dept defaults whenever active card changes ──
  useEffect(() => {
    if (!activeRateCardId || !getAdapter) {
      setEntries([])
      setDeptDefaults([])
      return
    }
    const adapter = getAdapter()
    if (!adapter) return
    setLoading(true)
    // Load entries and dept defaults in parallel
    Promise.all([
      adapter.listRateCardEntries(activeRateCardId),
      adapter.listDeptDefaults ? adapter.listDeptDefaults(activeRateCardId) : Promise.resolve([]),
    ])
      .then(([rows, defaults]) => {
        if (!mountedRef.current) return
        // Migrate: entries with day_rate but no wage → set wage = day_rate
        const migrated = (Array.isArray(rows) ? rows : []).map(e => {
          if (e.wage == null && e.day_rate != null) return { ...e, wage: e.day_rate }
          return e
        })
        setEntries(migrated)
        setDeptDefaults(Array.isArray(defaults) ? defaults : [])
      })
      .catch(err => {
        if (mountedRef.current) setError(err.message || String(err))
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [activeRateCardId, getAdapter])

  // ── Compute day_rate (total) for each entry for backward compat ──
  const entriesWithTotal = entries.map(e => {
    const { total } = computeEntryTotal(e, deptDefaults)
    return { ...e, day_rate: total }
  })

  // ── Helpers ──
  const normalizeEntry = useCallback((draft) => {
    const role_label = draft.role_label || draft.role || ''
    const role_slug = draft.role_slug || makeSlug(role_label)
    return {
      id: draft.id || uuidv4(),
      rate_card_id: activeRateCardId,
      role_label,
      role_slug,
      department: draft.department || null,
      member_id: draft.member_id || null,
      wage: draft.wage ?? draft.day_rate ?? null,
      burden: draft.burden ?? null,
      burden_type: draft.burden_type || 'percent',
      overhead: draft.overhead ?? null,
      overhead_type: draft.overhead_type || 'percent',
      region: draft.region || null,
      project_size: draft.project_size || null,
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

  // ── Department defaults ──
  const updateDeptDefault = useCallback(async (department, patch) => {
    if (!activeRateCardId || !getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.upsertDeptDefault) return
    const existing = deptDefaults.find(d => d.department === department) || { department }
    const updated = { ...existing, ...patch, department }
    setDeptDefaults(prev => {
      const idx = prev.findIndex(d => d.department === department)
      if (idx >= 0) return prev.map((d, i) => i === idx ? updated : d)
      return [...prev, updated]
    })
    try {
      const result = await adapter.upsertDeptDefault(activeRateCardId, updated)
      if (Array.isArray(result)) setDeptDefaults(result)
    } catch (err) {
      setError(err.message || String(err))
    }
  }, [activeRateCardId, getAdapter, deptDefaults])

  // ── Bulk upsert (used by importers) ──
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
    entries: entriesWithTotal,       // entries with computed day_rate (total)
    rawEntries: entries,             // entries without computed total
    deptDefaults,
    loading,
    error,
    reload: loadRateCards,
    addEntry,
    updateEntry,
    deleteEntry,
    updateDeptDefault,
    bulkUpsertEntries,
    makeSlug,
    computeEntryTotal: (entry) => computeEntryTotal(entry, deptDefaults),
  }
}
