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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useRabbitOnline } from '../../tools/rabbit_v0.1.0/state/rabbitLive'
import { usePermissions } from '../../permissions/usePermissions'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { createReadCache, useReadEntry, sourceId } from '../../lib/readCache'

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
  // F5: and the one rate card every reader shares (below).
  for (const r of retries.values()) clearTimeout(r.timer)
  retries.clear()
  cardsKeyNow = null
  cardsCache.clear()
  entriesCache.clear()
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
export function sharedLoadRateCards(adapter, workspaceId, who = '') {
  // F5: keyed on the adapter and the person as well as the workspace. On the
  // workspace alone, a read still out for the person who signed out answered
  // the person who signed in over them in the same company (and a switched
  // adapter's read answered the next adapter).
  const key = `${sourceId(adapter)}|${who}|${workspaceId}`
  const existing = inFlightLoads.get(key)
  if (existing) return existing
  const p = loadOrCreateRateCards(adapter, workspaceId)
    // Cleared on BOTH paths: a failed load that stayed cached would wedge every
    // later mount onto the same rejection with no way to retry.
    .finally(() => { inFlightLoads.delete(key) })
  inFlightLoads.set(key, p)
  return p
}

// ─── F5 (shared B2): ONE rate card for every reader ──────────────────────────
//
// Before F5 every useRateCard() held its own cards, entries and department
// defaults: sharedLoadRateCards (above) shared only a card read already in
// flight, each reader read its card's entries and defaults again, and an edit
// on the Rate Card page reached the other readers only when they remounted.
// Now two module-level caches (lib/readCache.js) hold them, and every reader
// draws from the same entries:
//   * the cards, one entry per adapter, mode, person and company, read through
//     sharedLoadRateCards, so its create-once guard is inside the store;
//   * each card's entries and department defaults, one entry per card.
// The card a reader shows stays its own (the Team Members page flips to the
// internal card while the Rate Card page shows the general one); it defaults
// to the default card, and only when it has none or its card is gone. An edit
// changes the card's one entry, so every reader of that card redraws with no
// read again. A failed read is tried again after 1.5 s, then 4 s, once per
// entry however many readers see it; a return online reads a failed entry
// once more.
const cardsCache = createReadCache()
const entriesCache = createReadCache({ empty: { entries: [], deptDefaults: [] } })
// F5 review round 1: before F5 every reader read the card at its own mount;
// the Rate Card, Settings and Team Members pages now hold the one entry all
// session, so a reader that mounts later than this after the last read reads
// it again (one read for every reader): a Budget opened in the afternoon shows
// the rates the server has now, and a grant revoked since shows none. No
// channel event carries a rate card.
const REVALIDATE_MS = 2000
let cardsKeyNow = null
const retries = new Map() // cache key → { timer, tries }
const RETRY_MS = [1500, 4000]
const NO_ROWS = Object.freeze([])

function cardsReader(adapter, workspaceId, who) {
  return () => sharedLoadRateCards(adapter, workspaceId, who)
}

function entriesReader(adapter, cardId) {
  return async () => {
    const [rows, defaults] = await Promise.all([
      adapter.listRateCardEntries(cardId),
      adapter.listDeptDefaults ? adapter.listDeptDefaults(cardId) : Promise.resolve([]),
    ])
    // Migrate legacy entries: day_rate → wage on read.
    const entries = (Array.isArray(rows) ? rows : []).map(e => {
      if (e.wage == null && e.day_rate != null) return { ...e, wage: e.day_rate }
      return e
    })
    return { entries, deptDefaults: Array.isArray(defaults) ? defaults : [] }
  }
}

// One timer per entry, however many readers see its error.
function retryLater(cache, key, reader) {
  const r = retries.get(key) || { timer: null, tries: 0 }
  if (r.timer || r.tries >= RETRY_MS.length) return
  r.timer = setTimeout(() => {
    r.timer = null
    cache.reload(key, reader)
  }, RETRY_MS[r.tries])
  r.tries += 1
  retries.set(key, r)
}
function settled(key) {
  const r = retries.get(key)
  if (!r) return
  clearTimeout(r.timer)
  retries.delete(key)
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
  // F4: the adapter's `online`, one word from a context of its own, and not
  // the status object off the value (rabbitLive.js). The load below runs
  // again when it flips, as before; a new status that says the same thing
  // does not draw this hook's host.
  const adapterOnline = useRabbitOnline(rabbit)
  // The adapter object is part of the key (readCache's sourceId): a switched
  // adapter is a new entry, and so is a test's new adapter.
  const adapter = getAdapter?.() || null
  const cardsKey = adapter && workspaceId
    ? `${sourceId(adapter)}|${adapterMode || ''}|${perms?.userId || '-'}|${workspaceId}`
    : null
  const cardsEntry = useReadEntry(cardsCache, cardsKey)

  useEffect(() => {
    if (!cardsKey) {
      // Signed out (or not yet known): no retry of the last person's fires.
      for (const r of retries.values()) clearTimeout(r.timer)
      retries.clear()
      return
    }
    if (cardsKeyNow !== cardsKey) {
      // Review round 2: a retry armed for another person, company or adapter
      // never fires for this one.
      for (const [k, r] of [...retries]) {
        if (k === cardsKey || k.startsWith(`${cardsKey}|`)) continue
        clearTimeout(r.timer)
        retries.delete(k)
      }
      // Another person, company or adapter: nothing of the last one's is kept.
      cardsKeyNow = cardsKey
      cardsCache.retain(k => k === cardsKey)
      entriesCache.retain(k => k.startsWith(`${cardsKey}|`))
    }
    cardsCache.revalidate(cardsKey, cardsReader(adapter, workspaceId, perms?.userId || '-'), REVALIDATE_MS)
  }, [cardsKey, adapter, workspaceId])

  useEffect(() => {
    if (!cardsKey) return
    cardsCache.noteOnline(cardsKey, adapterOnline, cardsReader(adapter, workspaceId, perms?.userId || '-'))
  }, [cardsKey, adapterOnline, adapter, workspaceId])

  useEffect(() => {
    if (!cardsKey) return
    if (cardsEntry.error && !cardsEntry.loading) retryLater(cardsCache, cardsKey, cardsReader(adapter, workspaceId, perms?.userId || '-'))
    else if (cardsEntry.loaded) settled(cardsKey)
  }, [cardsKey, cardsEntry.error, cardsEntry.loading, cardsEntry.loaded, adapter, workspaceId])

  // Back online after being offline, the retries start again (review round 1:
  // they were spent once a session; round 2: only on a real return, not at
  // every reader's mount).
  const wasOnlineRef = useRef(adapterOnline)
  useEffect(() => {
    const was = wasOnlineRef.current
    wasOnlineRef.current = adapterOnline
    if (adapterOnline === true && was === false && cardsKey) {
      for (const k of [...retries.keys()]) if (k === cardsKey || k.startsWith(`${cardsKey}|`)) settled(k)
    }
  }, [adapterOnline, cardsKey])

  const rateCards = cardsEntry.data?.cards || NO_ROWS
  const [chosenId, setChosenId] = useState(null)
  const defaultId = useMemo(() => {
    const next = rateCards.find(c => c.is_default) || rateCards.find(c => c.type === 'general') || rateCards[0] || null
    return next ? next.id : null
  }, [rateCards])
  const activeRateCardId = chosenId && rateCards.some(c => c.id === chosenId) ? chosenId : defaultId
  const setActiveRateCardId = useCallback((id) => setChosenId(id ?? null), [])

  const entriesKey = cardsKey && activeRateCardId ? `${cardsKey}|${activeRateCardId}` : null
  const entriesEntry = useReadEntry(entriesCache, entriesKey)

  useEffect(() => {
    if (entriesKey) entriesCache.revalidate(entriesKey, entriesReader(adapter, activeRateCardId), REVALIDATE_MS)
  }, [entriesKey, adapter, activeRateCardId])

  // Back online: a card's failed entries read once more too, retries anew.
  useEffect(() => {
    if (!entriesKey) return
    entriesCache.noteOnline(entriesKey, adapterOnline, entriesReader(adapter, activeRateCardId))
  }, [entriesKey, adapterOnline, adapter, activeRateCardId])

  useEffect(() => {
    if (!entriesKey) return
    if (entriesEntry.error && !entriesEntry.loading) retryLater(entriesCache, entriesKey, entriesReader(adapter, activeRateCardId))
    else if (entriesEntry.loaded) settled(entriesKey)
  }, [entriesKey, entriesEntry.error, entriesEntry.loading, entriesEntry.loaded, adapter, activeRateCardId])

  const entries = entriesEntry.data?.entries || NO_ROWS
  const deptDefaults = entriesEntry.data?.deptDefaults || NO_ROWS

  // An edit's failure is this reader's to show; a read's is every reader's.
  const [writeError, setWriteError] = useState(null)
  const error = writeError
    ?? cardsEntry.error
    ?? cardsEntry.data?.softError
    ?? entriesEntry.error
    ?? null

  const setEntries = useCallback((fn) => {
    if (entriesKey) entriesCache.mutate(entriesKey, d => ({ ...d, entries: fn(d.entries) }))
  }, [entriesKey])
  const setDeptDefaults = useCallback((fn) => {
    if (entriesKey) entriesCache.mutate(entriesKey, d => ({ ...d, deptDefaults: fn(d.deptDefaults) }))
  }, [entriesKey])
  const entriesNow = useCallback(() => (entriesKey ? entriesCache.peek(entriesKey).data?.entries : null) || NO_ROWS, [entriesKey])

  // Computed totals: one array per change of the card's entries, not per render.
  const entriesWithTotal = useMemo(() => entries.map(e => {
    const { total } = computeEntryTotal(e, deptDefaults)
    return { ...e, day_rate: total }
  }), [entries, deptDefaults])

  // ── Normalize a draft into a full entry ──
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

  // ── Mutations (optimistic, into the card's one entry) ──
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
      setWriteError(err.message || String(err))
      throw err
    }
  }, [activeRateCardId, getAdapter, normalizeEntry, setEntries])

  const updateEntry = useCallback(async (id, patch) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter) return
    const was = entriesNow().find(e => e.id === id) || null
    const merged = was ? { ...was, ...patch } : null
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
    try {
      const saved = await adapter.upsertRateCardEntry(merged || { id, ...patch })
      setEntries(prev => prev.map(e => e.id === id ? { ...e, ...saved } : e))
      return saved
    } catch (err) {
      // Roll back this row only: another reader's edit to another row stays.
      if (was) setEntries(prev => prev.map(e => e.id === id ? was : e))
      setWriteError(err.message || String(err))
      throw err
    }
  }, [getAdapter, entriesNow, setEntries])

  const deleteEntry = useCallback(async (id) => {
    if (!getAdapter || !activeRateCardId) return
    const adapter = getAdapter()
    if (!adapter) return
    const list = entriesNow()
    const at = list.findIndex(e => e.id === id)
    const was = at >= 0 ? list[at] : null
    setEntries(prev => prev.filter(e => e.id !== id))
    try {
      await adapter.deleteRateCardEntry(id, activeRateCardId)
    } catch (err) {
      if (was) setEntries(prev => (prev.some(e => e.id === id) ? prev : [...prev.slice(0, at), was, ...prev.slice(at)]))
      setWriteError(err.message || String(err))
      throw err
    }
  }, [getAdapter, activeRateCardId, entriesNow, setEntries])

  // ── Dept default mutations ──
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
      if (Array.isArray(result)) setDeptDefaults(() => result)
    } catch (err) {
      setWriteError(err.message || String(err))
    }
  }, [activeRateCardId, getAdapter, deptDefaults, setDeptDefaults])

  // ── Bulk upsert (for CSV/XLSX import) ──
  // Inserts each row sequentially so failures are isolated per row.
  // Returns { ok, error, entry } per input row in order.
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
  }, [getAdapter, activeRateCardId, normalizeEntry, setEntries])

  const reload = useCallback(() => {
    setWriteError(null)
    return cardsKey ? cardsCache.reload(cardsKey, cardsReader(adapter, workspaceId, perms?.userId || '-')) : Promise.resolve()
  }, [cardsKey, adapter, workspaceId])

  return {
    workspaceId,
    rateCards,
    activeRateCardId,
    setActiveRateCardId,
    entries: entriesWithTotal,       // entries with computed day_rate (total)
    rawEntries: entries,             // entries without computed total
    deptDefaults,
    loading: cardsEntry.loading || entriesEntry.loading,
    // S5c: the cards are read and the active card's entries with them (a
    // workspace with no card has none to read).
    settled: cardsEntry.loaded && (activeRateCardId == null || entriesEntry.loaded),
    error,
    reload,
    addEntry,
    updateEntry,
    deleteEntry,
    updateDeptDefault,
    bulkUpsertEntries,
    makeSlug,
    computeEntryTotal: (entry) => computeEntryTotal(entry, deptDefaults),
  }
}
