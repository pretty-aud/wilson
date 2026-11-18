// =============================================================================
// Confirm — the one confirm-width question (post-overhaul F10, rabbit A6).
// R.A.B.B.I.T.'s views wrote this shape seven times: two ConfirmDialogs
// (Levels/Experiences, Scenes), three bulk-delete Dialogs inline (Levels,
// Assets, Tasks), the shot lists' ListConfirm and the views' useAsk. Each now
// draws this; ListConfirm and useAsk keep their names and callers (useAsk is a
// promise around a question, not another question). AnswerDialog, the
// three-answer question at the form width, is not this shape and stays.
//
// The kit Dialog at the confirm width (W9): the title, the words, Cancel
// first and the verb second, in the variant its effect deserves (the kit's
// danger for one that takes something out of use, the primary for one that
// does not). Escape, the ✕ and Cancel answer no; the backdrop too where the
// caller asks (`dismissOnBackdrop`; a row's delete has it, a bulk one not).
//
// 🚨 Cancel takes focus in an EFFECT as well as by `autoFocus`. From a
// window's Delete the window closes in the same commit this opens:
// `autoFocus` puts focus on Cancel during the commit, the window's unmount
// hands focus back to what opened IT, and the Dialog's own effect, finding
// focus outside, lands it on ✕. This effect runs after both (a child's
// effects run before its parent's), so the question opens on Cancel from every
// path (B4c review round one; surface 6c).
//
// 🚨 …and on close, focus goes to `returnTo` when it has fallen to <body>:
// what opened the window whose Delete asked (the row's Open). The Dialog hands
// focus back to what had it when the question opened — that window's own
// Delete, gone with the window — so every close from that path dropped focus
// to <body> (B4c review round two). Only while `returnTo` is in the page: a
// delete takes the row, and its button, with it.
//
// `onConfirm` may answer a promise: then the question is busy from the press
// until the CALLER closes it (no Escape, no second press, Cancel greyed), as
// ListConfirm was — a promise that resolves leaves it busy, so a caller that
// answers one closes the question when it resolves (every caller today does;
// OUTSTANDING F10, review round 1, 1A-06). A refusal ends it: its words land
// in the Dialog's own error slot, verbatim, the question still open. A plain
// call is a plain call: the caller closes the question, and a caller with
// nothing to wait for hands a plain call (`() => { go() }`).
//
// The caller's other props reach the Dialog FIRST, so none can replace the
// shape this keeps (the width, the footer, busy, the error, the close).
//
// Portalled into <body> by default: the kit Dialog does not portal
// (B4-KR-2), and a container on the page must not hold a question.
// `portal={false}` keeps it where it is drawn (the Assets and Tasks bulk
// questions, and useAsk's, are drawn in place today).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from './Dialog'
import { Button } from './Button'

export function Confirm({
  title,
  children,
  confirmLabel = 'Delete',
  variant = 'danger',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  dismissOnBackdrop = false,
  returnTo = null,
  portal = true,
  ...rest
}) {
  const cancelRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The opener is read when the question closes, from the render that opened
  // it, as the two ConfirmDialogs read theirs.
  const returnToRef = useRef(returnTo)
  useEffect(() => {
    cancelRef.current?.focus()
    return () => {
      const target = returnToRef.current
      const active = document.activeElement
      if (target && target !== document.body && target.isConnected && (!active || active === document.body)) target.focus()
    }
  }, [])

  // Named for what it does, not `confirm` (rabbitCssGuards' scriptedLeaks
  // reads any `confirm(` as window.confirm, W9's ban).
  function proceed() {
    const out = onConfirm?.()
    if (!out || typeof out.then !== 'function') return
    setBusy(true)
    setError(null)
    out.then(null, (err) => {
      setError(err?.message || String(err))
      setBusy(false)
    })
  }

  const question = (
    <Dialog
      {...rest}
      width="confirm"
      title={title}
      busy={busy}
      error={error}
      dismissOnBackdrop={dismissOnBackdrop}
      onClose={onCancel}
      footer={(
        <>
          <Button ref={cancelRef} autoFocus disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={variant} loading={busy} onClick={proceed}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Dialog>
  )
  return portal ? createPortal(question, document.body) : question
}

export default Confirm
