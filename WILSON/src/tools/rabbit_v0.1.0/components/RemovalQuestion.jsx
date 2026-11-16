// =============================================================================
// RemovalQuestion — the question before the person's delete while a bid
// version is open (post-overhaul S5b, step 0, constraint 9).
//
// With a version OPEN, a row another saved version holds is not deleted: it is
// SET ASIDE ("Remove from this version") and stays in that version, whole.
// The delete paths that already ask (the Timeline editor, the Tasks bulk bar)
// say which in their own question; the paths that never asked (a Tasks row's
// trash button, the task popup's Delete) ask here ONLY when a row going aside
// has work on it — logged days, comments, files — so work is never hidden
// unasked. Every other delete runs at once, its undo toast saying which.
// One kit Dialog at the confirm width, Cancel first and focused (D21).
// =============================================================================

import React, { useState } from 'react'
import { Dialog, Button } from '../../../ui'
import { removalQuestion, removalNeedsAsking } from '../state/versionWords'

/**
 * ask(ids, run, noun) — `ids` { tasks, phases, milestones }; `run` the
 * delete (ctx.deleteTask …), which decides Remove or Delete itself. Runs at
 * once unless a removed row has work on it; then holds the question. Answers
 * true when it ran, false when it is waiting on the question.
 */
export function useRemovalAsk(ctx) {
  const [pending, setPending] = useState(null)
  function ask(ids, run, noun = 'task') {
    const plan = typeof ctx?.removalPlanFor === 'function' ? ctx.removalPlanFor(ids) : null
    if (!plan || !removalNeedsAsking(plan)) { run(); return true }
    setPending({ question: removalQuestion(plan, noun), run })
    return false
  }
  const dialog = pending ? (
    <RemovalQuestion
      question={pending.question}
      onCancel={() => setPending(null)}
      onConfirm={() => { const r = pending.run; setPending(null); r() }}
    />
  ) : null
  return { ask, dialog, asking: !!pending }
}

export default function RemovalQuestion({ question, onCancel, onConfirm }) {
  if (!question) return null
  return (
    <Dialog
      width="confirm"
      title={question.title}
      onClose={onCancel}
      footer={(
        <>
          <Button autoFocus onClick={onCancel}>Cancel</Button>
          <Button variant={question.danger ? 'danger' : 'primary'} onClick={onConfirm}>{question.confirm}</Button>
        </>
      )}
    >
      {question.sentences.map((s, i) => <p key={i} className="rb-removal-line">{s}</p>)}
    </Dialog>
  )
}
