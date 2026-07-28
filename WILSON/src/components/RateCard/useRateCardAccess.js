// =============================================================================
// useRateCardAccess — Session 9: effective rate-card access = role matrix
// OR the per-user grants (workspace_members.grant_rate_card_view/edit).
//
// The JWT shape is frozen (Session 1), so grants can NEVER ride claims —
// they're fetched from the caller's own membership row (the ws_members_select
// self-arm guarantees visibility even mid-deactivation) and kept LIVE off
// the workspace channel: workspace_members broadcasts full rows, so a
// grant/revoke lands within the 400ms debounce, no refresh needed.
//
// Pure logic lives in effectiveRateAccess() so vitest covers the matrix.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { usePermissions } from '../../permissions'
import { can } from '../../permissions'

/**
 * @param {'admin'|'manager'|'user'|null} role
 * @param {{ grant_rate_card_view?: boolean, grant_rate_card_edit?: boolean } | null} row
 * @returns {{ canView: boolean, canEdit: boolean }}
 */
export function effectiveRateAccess(role, row) {
  const grantView = !!(row?.grant_rate_card_view || row?.grant_rate_card_edit)
  const grantEdit = !!row?.grant_rate_card_edit
  return {
    canView: can(role, 'rate_card.view') || grantView || grantEdit,
    canEdit: can(role, 'rate_card.edit') || grantEdit,
  }
}

/**
 * @param {(cb: (evt: object) => void) => (() => void) | undefined} [subscribeWorkspaceEvents]
 *   Optional rabbit.subscribeWorkspaceEvents for live grant changes.
 */
export function useRateCardAccess(subscribeWorkspaceEvents) {
  const perms = usePermissions()
  const [row, setRow] = useState(null)
  const [rowReady, setRowReady] = useState(false)

  // StrictMode-safe mounted flag: the effect BODY must reset the flag to
  // true (setup → cleanup → setup on the same instance).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const reqSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++reqSeqRef.current
    if (!perms.userId || !perms.workspaceId) {
      setRow(null)
      setRowReady(true)
      return
    }
    // Role already grants everything edit implies — skip the fetch.
    if (can(perms.role, 'rate_card.edit')) {
      setRow(null)
      setRowReady(true)
      return
    }
    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('grant_rate_card_view, grant_rate_card_edit')
        .eq('workspace_id', perms.workspaceId)
        .eq('user_id', perms.userId)
        .maybeSingle()
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      // Column-missing tolerance (0020 not deployed): behave as ungranted.
      setRow(error ? null : (data ?? null))
      setRowReady(true)
    } catch {
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      setRow(null)
      setRowReady(true)
    }
  }, [perms.userId, perms.workspaceId, perms.role])

  useEffect(() => { load() }, [load])

  // Live refresh on own-row workspace_members events (grant flips land
  // without a reload). Held behind refs so the subscription never re-subs.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const userIdRef = useRef(perms.userId)
  useEffect(() => { userIdRef.current = perms.userId }, [perms.userId])

  useEffect(() => {
    if (typeof subscribeWorkspaceEvents !== 'function') return undefined
    let timer = null
    const unsub = subscribeWorkspaceEvents((evt) => {
      const uid = userIdRef.current
      const relevant = evt.op === 'RESYNC' ||
        (evt.table === 'workspace_members' &&
          (evt.record?.user_id === uid || evt.oldRecord?.user_id === uid))
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; loadRef.current() }, 400)
    })
    return () => { if (timer) clearTimeout(timer); unsub() }
  }, [subscribeWorkspaceEvents])

  const access = effectiveRateAccess(perms.role, row)
  return {
    ready: perms.ready && rowReady,
    role: perms.role,
    canView: access.canView,
    canEdit: access.canEdit,
    reload: load,
  }
}
