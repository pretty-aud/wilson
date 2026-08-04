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

export function useProjectRateOverrides() {
  const rabbit = useRabbit()
  const getAdapter    = rabbit?.getAdapter
  const projectId     = rabbit?.project?.id
  const adapterMode   = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [overrides, setOverrides] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const load = useCallback(async () => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    if (!adapter?.listProjectRateOverrides) return
    setLoading(true)
    setError(null)
    try {
      const list = await adapter.listProjectRateOverrides(projectId)
      if (mountedRef.current) setOverrides(Array.isArray(list) ? list : [])
    } catch (err) {
      // Money is manager-only at the RLS layer (0037), so a non-manager gets
      // an empty set rather than an error. An error here is a real fault and
      // must stay visible — an unreported failure and an empty override list
      // are different facts, and conflating them is what makes a broken
      // budget look like an unconfigured one.
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, projectId])

  useEffect(() => { load() }, [load, adapterMode, adapterStatus?.online])

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

    setOverrides(prev => {
      const i = prev.findIndex(o => o.id === row.id)
      if (i >= 0) return prev.map(o => (o.id === row.id ? { ...o, ...row } : o))
      return [...prev, row]
    })

    try {
      const saved = await adapter.upsertProjectRateOverride(row)
      if (mountedRef.current && saved?.id) {
        setOverrides(prev => prev.map(o => (o.id === row.id ? { ...row, ...saved } : o)))
      }
      return saved || row
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return null
    }
  }, [getAdapter, projectId, overrides])

  // Clearing an override is how a line goes back to the company rate card.
  const clearOverride = useCallback(async (id) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    setOverrides(prev => prev.filter(o => o.id !== id))
    try {
      if (adapter?.deleteProjectRateOverride) {
        await adapter.deleteProjectRateOverride(id, projectId)
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId])

  return { overrides, loading, error, reload: load, setOverride, clearOverride }
}
