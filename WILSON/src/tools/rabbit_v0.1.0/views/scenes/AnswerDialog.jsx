// ============================================================
// RABBIT — a question with more than one way forward
// (post-overhaul S3c, steps 4 and 7)
// ============================================================
//
// ListConfirm's sibling for the edit questions that have THREE answers:
// "Recover unsaved edit?" (Not now / Discard edit / Recover edit) and the
// leave guard (D12: Keep editing / Discard changes / Save edit). The kit
// Dialog at the confirm width, portalled into <body>; the answer that
// changes nothing first and focused, so Enter and Escape both keep things
// as they are (D12: "Escape = keep editing"; S3b's D21 iii for every
// question); then each answer in the variant its effect deserves — the
// kit's danger for one that throws work away, the primary for the one that
// keeps it — the primary last, at the far end, where a dialog's go-ahead
// sits (Jakob). While an answer runs the Dialog is busy (no Escape, no
// second press); a refusal lands in its error slot verbatim and the
// question stays.
//
// At the confirm width on purpose: ScenesView's Ctrl+Z / Ctrl+Y stand down
// while a kit Dialog at that width is on screen (questionOnScreen).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Button } from '../../../../ui'
import '../rabbitScenes.css'

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
      width="confirm"
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
