// ============================================================
// RABBIT — a shot-list question (post-overhaul S3b)
// ============================================================
//
// The kit Dialog at the confirm width, portalled into <body> (the kit Dialog
// does not portal, B4-KR-2), as ScenesView's delete question is: Cancel
// first and focused, so Enter cancels (D21 iii; walkthrough 45's Q25); the
// verb second, in the variant its effect deserves — the kit's danger for one
// that takes something out of use (Clear, Withdraw, Archive, Remove), the
// primary for one that does not (Set active). While the verb runs the
// Dialog is busy (no Escape, no second press); a refusal lands in the
// Dialog's own error slot in the backend's words, verbatim, and the
// question stays open, so the person reads why where they asked.
//
// At the confirm width on purpose: ScenesView's Ctrl+Z / Ctrl+Y stand down
// while any kit Dialog at that width is on screen (R2-01, questionOnScreen).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Button } from '../../../../ui'
import '../rabbitScenes.css'

/**
 * title / children   the question and what it does
 * confirmLabel       the verb
 * variant            'danger' | 'primary'
 * onConfirm          async; resolve to close, throw to stay open with the sentence
 * onCancel           closes it
 */
export default function ListConfirm({ title, children, confirmLabel, variant = 'danger', onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Focus on Cancel after the Dialog's own effect, whatever opened it (the
  // delete question's lesson: a menu or a popup closing in the same commit
  // hands focus elsewhere first).
  useEffect(() => { cancelRef.current?.focus() }, [])
  // Named for what it does, not `confirm` (rabbitCssGuards' scriptedLeaks
  // reads any `confirm(` as window.confirm, W9's ban).
  async function proceed() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }
  return createPortal(
    <Dialog
      width="confirm"
      title={title}
      busy={busy}
      error={error}
      onClose={onCancel}
      footer={(
        <>
          <Button ref={cancelRef} autoFocus disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant={variant} loading={busy} onClick={proceed}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Dialog>,
    document.body,
  )
}
