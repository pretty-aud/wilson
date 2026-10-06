// ============================================================
// useProjectRateOverrides — project-scoped rate overrides
// ============================================================
//
// Session 24. Audrey, twice, for both real people and bid roles:
//
//   "when a manager makes a change on the rate card in a project that is
//    going to be project specific meaning the managers change should not
//    change the internal rate card. some projects will have different rates
//    for people."
//
// rate_cards / rate_card_entries are WORKSPACE-level. Editing a rate through
// useRateCard from inside a project would rewrite that rate for every other
// project in the company — silently, with nothing recording what the other
// projects' numbers used to be. This hook is the separate store that stops
// that, and `budgetMath.resolveRate` is the resolution order it feeds:
//
//     project override -> workspace rate card -> blank
//
// Follows the useBudgetLines/useExpenses shape: feature-detected adapter,
// optimistic state, mounted-ref guard.

import { useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { buildProjectRatesMirror } from '../../tools/rabbit_v0.1.0/projectRates'

export function useProjectRateOverrides() {
  const rabbit = useRabbit()
  const getAdapter    = rabbit?.getAdapter
  const project       = rabbit?.project
  const projectId     = rabbit?.project?.id
  const adapterMode   = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [overrides, setOverrides] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  // Post-overhaul S5c: the provider's rateOverridesEpoch the list on hand was
  // read at (null until the first read lands). The Budget's versions block
  // compares a bid against the live rates: until this equals the epoch, the
  // list may still be the one from before an open wrote the version's rates
  // (or the empty first render's), and "unsaved changes" would be read off
  // rates nobody changed.
  const [loadedEpoch, setLoadedEpoch] = useState(null)
  const epochRef = useRef(rabbit?.rateOverridesEpoch ?? 0)
  epochRef.current = rabbit?.rateOverridesEpoch ?? 0

  // Post-overhaul S5c review round 2 (R2-02): the list on hand, the epoch it
  // was read at and its error are ONE project's. The epoch is the provider's,
  // not the project's, so after a switch (the Budget stays mounted) the
  // previous project's list read as this one's at the same epoch: a failed
  // read of this project then opened the versions block with the other
  // project's rates — "Saved" / "Unsaved changes", the variance, and a Save
  // that wrote them into this project's bid. Reset in the very render the
  // project changes (React renders again at once, before anything is shown),
  // and a read that answers for a project no longer open never lands.
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const [stateFor, setStateFor] = useState(projectId)
  if (stateFor !== projectId) {
    setStateFor(projectId)
    setOverrides([])
    setLoadedEpoch(null)
    setError(null)
  }

  const mountedRef = useRef(true)
  // Set true in the effect, not only by useRef: StrictMode (dev) runs the
  // cleanup once between two mounts, and a guard that only ever goes false
  // drops every later load — the Talent tab said "Loading talent..." for
  // ever and the Expenses tab showed nothing (B5; B4c's FileAuditDrawer had
  // the same). A production build mounts once and is unchanged.
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── The rates mirror (Session 27) ─────────────────────────────────────
  //
  // Audrey, 2026-08-03: the project's own rates should live in the project
  // folder as a readable file. S26 shipped the manifest without them because
  // the manifest's path is readable by every project member; 0042 gives them
  // a manager-only path and this is the writer.
  //
  // It lives HERE, next to the store, rather than in RabbitProvider like the
  // manifest, for one reason: RLS already decided. Anyone who successfully
  // wrote a project rate override is money-cleared by definition, so the
  // mirror is written by exactly the people allowed to read it and no caller
  // has to re-derive the permission. A non-manager who somehow reached this
  // gets a storage refusal, which is the same answer from the authority.
  const mirrorTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(mirrorTimerRef.current), [])

  // Debounced like writeManifestSoon — the rate inputs write on change, so a
  // pass over a crew list would otherwise upload one object per keystroke.
  //
  // The overrides are passed IN rather than read from state at fire time.
  // That is deliberate: state could belong to a different project by then,
  // and this payload/target pair is captured together, so it is not possible
  // to write project A's rates into project B's folder. writeManifestSoon
  // needs an explicit id guard for exactly this; passing the data avoids it.
  const writeRatesMirrorSoon = useCallback((nextOverrides) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    // Feature-detect: Drive is read-only, and a client older than this session
    // has no such method.
    if (typeof adapter?.writeProjectRates !== 'function') return
    const snapshot = { id: projectId, project, list: nextOverrides }
    clearTimeout(mirrorTimerRef.current)
    mirrorTimerRef.current = setTimeout(async () => {
      try {
        await adapter.writeProjectRates(
          snapshot.id,
          buildProjectRatesMirror(snapshot.project, snapshot.list, new Date().toISOString()),
        )
      } catch (err) {
        // Best-effort, and it must stay that way: the rates themselves are
        // saved in the database, which is authoritative. A folder that cannot
        // be written is not a reason to fail the edit the user just made.
        console.warn(
          `[rabbit] could not write the rates mirror for ${snapshot.id}: `
          + `${err.message || err}. The rates are saved — this file is a mirror.`
        )
      }
    }, 1500)
  }, [getAdapter, projectId, project])

  // Post-overhaul S5c review round 1 (R1-07): one failed read left the list
  // stale — and the Budget's versions block greyed, "reading the rates" —
  // for as long as the page stayed mounted. A failed read is tried again,
  // after 1.5s and then 4s, before its error stands; a read that lands, or a
  // new epoch's read, starts the count again.
  const RETRY_MS = [1500, 4000]
  const retryRef = useRef({ timer: null, tries: 0 })
  const loadRef = useRef(null)
  useEffect(() => () => clearTimeout(retryRef.current.timer), [])

  // Post-overhaul S5 review round 1: an open writes several rates in a row and
  // each bumps the epoch, so loads overlap; only the newest may land.
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    // A backend with no project rates has none to read: its empty list is
    // the true one, at every epoch (S5c).
    if (!adapter?.listProjectRateOverrides) { setLoadedEpoch(epochRef.current); return }
    const seq = ++loadSeqRef.current
    const forEpoch = epochRef.current
    const forProject = projectId
    // Another read began since, or another project is open now (R2-02).
    const superseded = () => seq !== loadSeqRef.current || forProject !== projectIdRef.current
    setLoading(true)
    setError(null)
    try {
      const list = await adapter.listProjectRateOverrides(projectId)
      if (superseded()) return
      if (mountedRef.current) {
        setOverrides(Array.isArray(list) ? list : [])
        setLoadedEpoch(forEpoch)
      }
      retryRef.current.tries = 0
    } catch (err) {
      if (superseded()) return
      // Money is manager-only at the RLS layer (0037), so a non-manager gets
      // an empty set rather than an error. An error here is a real fault and
      // must stay visible — an unreported failure and an empty override list
      // are different facts, and conflating them is what makes a broken
      // budget look like an unconfigured one.
      if (mountedRef.current) setError(err.message || String(err))
      const r = retryRef.current
      if (mountedRef.current && r.tries < RETRY_MS.length) {
        clearTimeout(r.timer)
        r.timer = setTimeout(() => { if (mountedRef.current) loadRef.current?.() }, RETRY_MS[r.tries])
        r.tries += 1
      }
    } finally {
      if (seq === loadSeqRef.current && mountedRef.current) setLoading(false)
    }
  }, [getAdapter, projectId])
  loadRef.current = load

  // Post-overhaul S5: opening a bid version writes its role rates as project
  // overrides from the provider; the provider bumps rateOverridesEpoch after
  // each such write (and its undo), and this list reloads.
  const rateOverridesEpoch = rabbit?.rateOverridesEpoch ?? 0
  useEffect(() => {
    clearTimeout(retryRef.current.timer)
    retryRef.current.tries = 0
    load()
  }, [load, adapterMode, adapterStatus?.online, rateOverridesEpoch])

  // Set a project rate. Exactly one of roleSlug / memberId — the database
  // CHECK refuses both or neither, because a row keyed by both has no single
  // resolution order.
  const setOverride = useCallback(async ({ roleSlug = null, memberId = null, ...rates }) => {
    if (!getAdapter || !projectId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertProjectRateOverride) return null

    const existing = overrides.find(o =>
      memberId ? o.member_id === memberId : (o.role_slug === roleSlug && !o.member_id))

    const row = {
      id: existing?.id || uuidv4(),
      project_id: projectId,
      role_slug: memberId ? null : roleSlug,
      member_id: memberId || null,
      ...rates,
    }

    const next = overrides.some(o => o.id === row.id)
      ? overrides.map(o => (o.id === row.id ? { ...o, ...row } : o))
      : [...overrides, row]
    setOverrides(next)

    try {
      const saved = await adapter.upsertProjectRateOverride(row)
      if (mountedRef.current && saved?.id) {
        setOverrides(prev => prev.map(o => (o.id === row.id ? { ...row, ...saved } : o)))
      }
      // Only after the write LANDED. Mirroring an optimistic value would put a
      // rate in the project folder that the database refused.
      writeRatesMirrorSoon(next.map(o => (o.id === row.id ? { ...row, ...(saved || {}) } : o)))
      return saved || row
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return null
    }
  }, [getAdapter, projectId, overrides, writeRatesMirrorSoon])

  // Clearing an override is how a line goes back to the company rate card.
  const clearOverride = useCallback(async (id) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    const next = overrides.filter(o => o.id !== id)
    setOverrides(next)
    try {
      if (adapter?.deleteProjectRateOverride) {
        await adapter.deleteProjectRateOverride(id, projectId)
      }
      // A REMOVED rate has to reach the mirror too. A file that keeps showing
      // a rate the project no longer uses is worse than no file, because it
      // reads as current — and this is the direction that gets forgotten,
      // since nothing on screen changes to prompt it.
      writeRatesMirrorSoon(next)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId, overrides, writeRatesMirrorSoon])

  return { overrides, loading, error, loadedEpoch, reload: load, setOverride, clearOverride }
}
