// ============================================================
// RABBIT — cross-tab navigation (milestone 2)
// ============================================================
//
// The shell (Rabbit.jsx) owns `activeView` and the views are mounted one at
// a time, so "open this shot in Scenes" from the bin inspector, or "show this
// file in Bins" from a shot's takes, has nowhere to go: the target view is not
// mounted when the request is made. This module carries the request across
// that gap: the shell switches tabs on the event, and the target view
// consumes the pending payload when it mounts (or at once, if it is already
// mounted). One pending request at a time; the newest wins.
//
// Two rules from the adversarial review: a payload carries the project it
// was made for and is dropped for any other (a request that was never
// consumed must not open another project's shot later), and a target may
// DECLINE a payload (its handler returns false — the file has not loaded yet),
// which leaves it pending for the next attempt instead of losing it.

import { useEffect } from 'react'

const EVENT = 'rabbit:navigate'
let pending = null

/** { view: 'scenes' | 'bins' | …, projectId, shotId?, sceneId?, fileId? } */
export function navigateTo(detail) {
  if (!detail || !detail.view) return
  pending = { ...detail }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: pending }))
}

export function subscribeNavigate(fn) {
  if (typeof window === 'undefined') return () => {}
  const h = (e) => fn(e.detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/**
 * For a view: try the pending request on mount and whenever `handler` or the
 * project changes, and again on every later request while mounted. The
 * handler returns false to decline (the payload stays pending); anything else
 * accepts it. A payload stamped with another project is discarded.
 */
export function useNavigateTarget(view, handler, projectId = null) {
  useEffect(() => {
    const attempt = () => {
      const p = pending
      if (!p || p.view !== view) return
      if (projectId && p.projectId && p.projectId !== projectId) { pending = null; return }
      const accepted = handler(p) !== false
      if (accepted && pending === p) pending = null
    }
    attempt()
    return subscribeNavigate((d) => { if (d?.view === view) attempt() })
  }, [view, handler, projectId])
}
