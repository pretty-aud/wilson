// ============================================================
// RABBIT — "Save the edit before leaving?" (post-overhaul S3c, step 7; D12)
// ============================================================
//
// The leave guard's question for the unsaved edit (state/leaveGuard.js): the
// provider opens it (`leaveAsk`) when an exit asks — the tab strip, a jump out
// of Scenes, a project switch, a tool or page switch, the edit selector — and
// it answers with D12's three: Keep editing (first and focused; Escape too),
// Discard changes (the kit's danger: it throws work away), Save edit (the
// primary, last, where a dialog's go-ahead sits). Save edit writes every
// unsaved edit of the open project as its next version, under the name the
// first-change question gave it; a refusal stays in the question, verbatim,
// and nothing is left. The window's close asks the same three in App's own
// question, not this one (one question, never two).
//
// Rendered once, by App, inside RabbitProvider: an exit can be asked from
// any page (App's navigateTo).
// ============================================================

import { useRabbit } from '../../state/RabbitProvider'
import AnswerDialog from './AnswerDialog'

/** The question's words: what is unsaved, and what each answer does. */
export function leaveWords(unsaved) {
  return `${unsaved} Save edit keeps it as its next version; Discard changes drops it; Keep editing goes back to it.`
}

export default function LeaveEditDialog() {
  const ctx = useRabbit()
  const ask = ctx?.leaveAsk
  if (!ask) return null
  return (
    <AnswerDialog
      title="Save the edit before leaving?"
      stayLabel="Keep editing"
      onStay={() => ctx.answerLeave(false)}
      answers={[
        { label: 'Discard changes', variant: 'danger', onClick: async () => { ctx.discardOpenDrafts(); ctx.answerLeave(true) } },
        { label: 'Save edit', variant: 'primary', onClick: async () => { await ctx.saveOpenDrafts(); ctx.answerLeave(true) } },
      ]}
    >
      {leaveWords(ctx.describeUnsavedEdits())}
    </AnswerDialog>
  )
}
