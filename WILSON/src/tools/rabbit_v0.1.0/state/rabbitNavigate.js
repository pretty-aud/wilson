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

import { useEffect } from 'react'

const EVENT = 'rabbit:navigate'
let pending = null

/** { view: 'scenes' | 'bins' | …, shotId?, sceneId?, fileId? } */
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

/** The pending request for `view`, consumed; null when there is none. */
export function consumePending(view) {
  if (pending && pending.view === view) { const p = pending; pending = null; return p }
  return null
}

/** For a view: consume a pending request on mount, and any later one while mounted. */
export function useNavigateTarget(view, handler) {
  useEffect(() => {
    const p = consumePending(view)
    if (p) handler(p)
    return subscribeNavigate((d) => { if (d?.view === view) { const q = consumePending(view); if (q) handler(q) } })
    // handler is read fresh through the closure on every mount; views pass a
    // stable callback or accept re-subscription when it changes.
  }, [view, handler])
}
