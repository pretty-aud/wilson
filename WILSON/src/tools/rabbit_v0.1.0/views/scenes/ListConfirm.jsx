// ============================================================
// RABBIT — a shot-list question (post-overhaul S3b)
// ============================================================
//
// The kit's Confirm (post-overhaul F10, rabbit A6: the one confirm-width
// question; this file was one of its seven copies), portalled into <body>:
// Cancel first and focused, so Enter cancels (D21 iii; walkthrough 45's
// Q25); the verb second, in the variant its effect deserves — the kit's
// danger for one that takes something out of use (Clear, Withdraw, Archive,
// Remove), the primary for one that does not (Set active). While the verb
// runs the question is busy (no Escape, no second press); a refusal lands in
// the Dialog's own error slot in the backend's words, verbatim, and the
// question stays open, so the person reads why where they asked. Every verb
// here is answered as a promise, so a press is busy until its caller closes
// the question, as it always was.
//
// At the confirm width on purpose: ScenesView's Ctrl+Z / Ctrl+Y stand down
// while any kit Dialog at that width is on screen (R2-01, questionOnScreen).
// The Budget's version questions ask through this file too.
// ============================================================

import { Confirm } from '../../../../ui'
import '../rabbitScenes.css'

/**
 * title / children   the question and what it does
 * confirmLabel       the verb
 * variant            'danger' | 'primary'
 * onConfirm          async; resolve to close, throw to stay open with the sentence
 * onCancel           closes it
 */
export default function ListConfirm({ title, children, confirmLabel, variant = 'danger', onConfirm, onCancel }) {
  return (
    <Confirm title={title} confirmLabel={confirmLabel} variant={variant}
      onConfirm={async () => onConfirm()} onCancel={onCancel}>
      {children}
    </Confirm>
  )
}
