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

import { useCallback, useRef, useState } from 'react'
import { Button, Dialog } from '../../../../ui'
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
    <Dialog
      width="confirm"
      title={asking.title}
      onClose={() => answer(false)}
      footer={(
        <>
          <Button autoFocus onClick={() => answer(false)}>Cancel</Button>
          <Button variant={asking.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>{asking.confirm || 'OK'}</Button>
        </>
      )}
    >
      {typeof asking.body === 'string' ? <p className="rb-tv-ask">{asking.body}</p> : (asking.body || null)}
    </Dialog>
  ) : null
  return { ask, dialog }
}
