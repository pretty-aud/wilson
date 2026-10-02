// ============================================================
// RABBIT — a question with more than one way forward
// (post-overhaul S3c, steps 4 and 7)
// ============================================================
//
// ListConfirm's sibling for the edit questions that have THREE answers:
// "Recover unsaved edit?" (Not now / Discard edit / Recover edit) and the
// leave guard (D12: Keep editing / Discard changes / Save edit). The kit
// Dialog at the FORM width — three answers at the kit's button size do not
// fit the confirm width's one row (they wrapped, the go-ahead alone on a
// second line) — portalled into <body>; the answer that
// changes nothing first and focused, so Enter and Escape both keep things
// as they are (D12: "Escape = keep editing"; S3b's D21 iii for every
// question); then each answer in the variant its effect deserves — the
// kit's danger for one that throws work away, the primary for the one that
// keeps it — the primary last, at the far end, where a dialog's go-ahead
// sits (Jakob). While an answer runs the Dialog is busy (no Escape, no
// second press); a refusal lands in its error slot verbatim and the
// question stays.
//
// It counts itself while open (`answersOpen`): ScenesView's Ctrl+Z / Ctrl+Y
// stand down under a question (questionOnScreen), which they otherwise
// recognise by the confirm width.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Button } from '../../../../ui'
import '../rabbitScenes.css'

/** How many of these questions are open now (ScenesView's questionOnScreen reads it). */
export const answersOpen = { count: 0 }

/**
 * title / children   the question, and what each answer does
 * stayLabel          the answer that changes nothing ("Keep editing", "Not now")
 * onStay             closes it (Escape, the close button, that answer)
 * answers            [{ label, variant: 'danger' | 'primary', onClick }] —
 *                    onClick async: resolve to be done (the caller closes),
 *                    throw to stay open with the sentence
 */
export default function AnswerDialog({ title, children, stayLabel, onStay, answers = [] }) {
  const stayRef = useRef(null)
  const [running, setRunning] = useState(null)
  const [error, setError] = useState(null)
  // Focus on the staying answer after the Dialog's own effect, whatever
  // opened it (ListConfirm's lesson).
  useEffect(() => { stayRef.current?.focus() }, [])
  useEffect(() => {
    answersOpen.count += 1
    return () => { answersOpen.count -= 1 }
  }, [])
  async function answer(i) {
    setRunning(i)
    setError(null)
    try {
      await answers[i].onClick()
    } catch (err) {
      setError(err?.message || String(err))
      setRunning(null)
    }
  }
  const busy = running != null
  return createPortal(
    <Dialog
      width="form"
      title={title}
      busy={busy}
      error={error}
      onClose={onStay}
      footer={(
        <>
          <Button ref={stayRef} autoFocus disabled={busy} onClick={onStay}>{stayLabel}</Button>
          {answers.map((a, i) => (
            <Button key={a.label} variant={a.variant} loading={running === i} disabled={busy && running !== i} onClick={() => answer(i)}>
              {a.label}
            </Button>
          ))}
        </>
      )}
    >
      {children}
    </Dialog>,
    document.body,
  )
}
