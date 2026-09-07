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
import { usePermissions } from '../../permissions/usePermissions'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'

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


// ─── Shared auto-create guard (Session 21) ───────────────────────────────────
//
// There are EIGHT independent useRateCard() consumers — RateCardPage,
// SettingsPage, TeamMembersPage, TaskDetailPopup, BudgetView, ScenesView,
// LevelsView, ExperiencesView — and no provider or cache between them. Each
// mount runs its own loadRateCards(), and the auto-create block below fires
// whenever it observes zero cards. Two instances mounting together therefore
// both observe zero and both create the pair.
//
// This is not hypothetical. The local Electron store, which has been
// persisting `type` since April, holds FOUR 'Internal Rate Card' rows for one
// workspace, created inside 53 ms of each other on 2026-04-11 — four mounts,
// none of which saw the others. (The same workspace holds three 'general'
// cards too, but those are older and from a different code path, so they are
// not evidence of THIS race.)
//
// It has been invisible in cloud mode only because the create FAILED there:
// `type` did not exist, so PostgREST rejected every insert with PGRST204.
// Migration 0032 removes that accidental brake, so without this guard the fix
// would trade "no rate cards" for "seven rate cards" — a fresh way for the
// surface to lie.
//
// A shared in-flight promise per workspace collapses concurrent mounts onto
// one load-and-create. It does not address two DEVICES racing; that needs a
// uniqueness constraint the data cannot currently take (see 0032's header).
const inFlightLoads = new Map()

/** Test seam: concurrent-mount dedup is global, so tests must be able to clear it. */
export function __resetRateCardLoadCache() {
  inFlightLoads.clear()
}

/**
 * List a workspace's rate cards, creating the General/Internal pair when the
 * workspace has none and the adapter can write.
 *
 * @returns {Promise<{cards: Array, softError: string|null}>} softError is a
 *   failure that must be SHOWN but must not discard the cards we did get — a
 *   silently-missing internal card makes member-rate writes land on General.
 */
async function loadOrCreateRateCards(adapter, workspaceId) {
  let cards = await adapter.listRateCards(workspaceId)
  if (!Array.isArray(cards)) cards = []
  let softError = null

  // Auto-create General + Internal when none exist. Session 17 (§6 #49): only
  // where the adapter can actually write. Google Drive is read-only in v0.1, so
  // this branch used to call the throwing upsertRateCard stub and leave a
  // permanent red banner — making the empty read look like a failure instead of
  // an empty page.
  if (cards.length === 0 && adapterSupportsWrites(adapter.mode)) {
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
      softError = err.message || String(err)
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
          try { await adapter.upsertRateCard(c) } catch { /* cosmetic */ }
        }
      }
    }
    if (!hasInternal && adapterSupportsWrites(adapter.mode)) {
      try {
        const internalCard = await adapter.upsertRateCard({
          id: uuidv4(),
          workspace_id: workspaceId,
          name: 'Internal Rate Card',
          type: 'internal',
          is_default: false,
        })
        if (internalCard) cards.push(internalCard)
      } catch (err) {
        // Surface it — a silently-missing internal card makes member-rate
        // writes land on the General card (see TeamMembersPage guard).
        softError = err.message || String(err)
      }
    }
  }
  return { cards, softError }
}

/**
 * loadOrCreateRateCards, deduplicated per workspace for the lifetime of one
 * in-flight call. Every concurrent caller awaits the SAME promise, so the
 * create runs once no matter how many hook instances mount together.
 */
export function sharedLoadRateCards(adapter, workspaceId) {
  const existing = inFlightLoads.get(workspaceId)
  if (existing) return existing
  const p = loadOrCreateRateCards(adapter, workspaceId)
    // Cleared on BOTH paths: a failed load that stayed cached would wedge every
    // later mount onto the same rejection with no way to retry.
    .finally(() => { inFlightLoads.delete(workspaceId) })
  inFlightLoads.set(workspaceId, p)
  return p
}

export function useRateCard() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const getAdapter = rabbit?.getAdapter
  // 🚨 THIS LINE WAS `rabbit?.DEFAULT_WORKSPACE_ID` AND IT BROKE THE WHOLE
  // SCREEN IN CLOUD MODE.
  //
  // DEFAULT_WORKSPACE_ID is '00000000-0000-0000-0000-000000000001' — the
  // pre-multi-tenant seed constant. supabaseAdapter.js:799 already documents
  // exactly this trap for projects: "harmless in local mode and fatal in
  // cloud mode: projects_insert requires workspace_id = current_workspace_id(),
  // so the insert was refused 42501 for EVERY workspace except the seed."
  // The fix landed for projects and never reached the rate card.
  //
  // Measured on wilson-staging 2026-08-10: Audrey's workspace is Petal Studios
  // (aaaaaaaa-…), so the card INSERT sent 00000000-… , rate_cards_insert's
  // WITH CHECK compared it against her real claim, and refused — the exact
  // "new row violates row-level security policy for table rate_cards" on her
  // screen. The SELECT then filtered on the same wrong id, so the grid said
  // "No rate card available", internalCard stayed null, and the INTERNAL tab
  // click did nothing. One wrong constant, four symptoms.
  //
  // perms.workspaceId is the JWT's app_metadata.workspace_id and is null when
  // there is no session, so LOCAL/desktop mode still falls through to the seed
  // constant, where it is correct.
  //
  // 🚨 GATED ON `perms.ready`, AND THAT IS THE WHOLE FIX, NOT A REFINEMENT.
  // usePermissions resolves the session ASYNCHRONOUSLY: on the first render
  // `workspaceId` is null and `ready` is false. Without this gate the fallback
  // fires immediately with the seed constant, so the create-on-first-visit
  // runs against 00000000-… , is refused by RLS, and leaves the red banner —
  // which is exactly what it did after the previous fix, because that fix
  // corrected WHICH id is used and not WHEN it is read.
  //
  // `ready` flips true on BOTH branches of the session probe (resolved and
  // failed), so a signed-out desktop session still reaches the seed constant.
  // This is the "`ready` is the field everyone forgets" rule in
  // docs — permission-gate rules; it has now cost two sessions.
  const workspaceId = perms?.ready
    ? (perms.workspaceId || rabbit?.DEFAULT_WORKSPACE_ID)
    : null
  const adapterMode = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [rateCards, setRateCards] = useState([])
  const [activeRateCardId, setActiveRateCardId] = useState(null)
  const [entries, setEntries] = useState([])
  const [deptDefaults, setDeptDefaults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // StrictMode-safe: the body must reset to true — setup → cleanup → setup
  // reuses the same ref, and a cleanup-only effect strands it at false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Load rate cards on mount + on adapter mode change ──
  const loadRateCards = useCallback(async () => {
    if (!getAdapter || !workspaceId) return
    const adapter = getAdapter()
    if (!adapter) return
    setLoading(true)
    setError(null)
    try {
      // Shared per workspace: eight hook instances mounting together must not
      // each create a card pair. See sharedLoadRateCards above.
      const { cards, softError } = await sharedLoadRateCards(adapter, workspaceId)
      if (!mountedRef.current) return
      if (softError) setError(softError)
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
    // Stale-response guard: the active card can change while a fetch is in
    // flight (e.g. the Team Members page flips general → internal right
    // after load). Without this, a slow response for the OLD card would
    // overwrite the new card's entries/defaults.
    let stale = false
    // Load entries and dept defaults in parallel
    Promise.all([
      adapter.listRateCardEntries(activeRateCardId),
      adapter.listDeptDefaults ? adapter.listDeptDefaults(activeRateCardId) : Promise.resolve([]),
    ])
      .then(([rows, defaults]) => {
        if (!mountedRef.current || stale) return
        // Migrate: entries with day_rate but no wage → set wage = day_rate
        const migrated = (Array.isArray(rows) ? rows : []).map(e => {
          if (e.wage == null && e.day_rate != null) return { ...e, wage: e.day_rate }
          return e
        })
        setEntries(migrated)
        setDeptDefaults(Array.isArray(defaults) ? defaults : [])
      })
      .catch(err => {
        if (mountedRef.current && !stale) setError(err.message || String(err))
      })
      .finally(() => {
        if (mountedRef.current && !stale) setLoading(false)
      })
    return () => { stale = true }
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
