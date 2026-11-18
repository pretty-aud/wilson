// ============================================================
// RABBIT — the custom views' questions, asked at the view's root (VW1d)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.2 (VW1d step 0 review, finding 18):
// the dropdown's confirm Dialogs are rendered at the view's root, as the
// view's other Dialogs are, never inside the in-place card. The dropdown,
// the bar (Q-G3) and a group's *…* (*Remove grouping*, Q-D5) ask through
// this; the table renders `dialog` once. *Cancel* has the keyboard (the safe
// answer first); Escape answers Cancel (the kit Dialog's topmost-only
// Escape, and a Popover under it stands down while it is open).
//
// The question itself is the kit's Confirm since post-overhaul F10 (rabbit
// A6, the one confirm-width question), drawn in place as before; this hook
// is the promise around it, which the views and the dropdown await.

import { useCallback, useRef, useState } from 'react'
import { Confirm } from '../../../../ui'
import './tableViews.css'

/** `ask({ title, body, confirm, danger })` answers true or false; render `dialog` at the root. */
export function useAsk() {
  const [asking, setAsking] = useState(null)
  const resolveRef = useRef(null)
  const ask = useCallback((opts) => new Promise((resolve) => {
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setAsking(opts || {})
  }), [])
  const answer = useCallback((yes) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setAsking(null)
    resolve?.(yes)
  }, [])
  const dialog = asking ? (
    <Confirm
      portal={false}
      title={asking.title}
      confirmLabel={asking.confirm || 'OK'}
      variant={asking.danger ? 'danger' : 'primary'}
      onCancel={() => answer(false)}
      onConfirm={() => { answer(true) }}
    >
      {typeof asking.body === 'string' ? <p className="rb-tv-ask">{asking.body}</p> : (asking.body || null)}
    </Confirm>
  ) : null
  return { ask, dialog }
}
