import { Play, RotateCcw } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

/**
 * Unified proposal popup for agent generation actions.
 *
 * Props:
 *   proposalData  - { mode: 'single_subject' | 'full_course', topic?, description?, softwareName? }
 *   onGenerate    - () => void — run the real generation pipeline
 *   onRefresh     - () => void — re-ask agent for a different proposal
 *   onCancel      - () => void
 *   loading       - boolean
 *
 * UI overhaul P1 (the §7 grep audit): this was a hand-drawn overlay — a
 * private backdrop, the stone palette, an orange frame, a Tailwind
 * `shadow-2xl`, a GREEN primary where the app's one filled primary is the
 * signal fill (Q16), Title Case labels and a disabled state drawn as
 * `opacity-50` three times (§3.1: disabled is the third ink and
 * `not-allowed`, never an opacity). It is the kit Dialog now (Q17: its
 * Escape, stack and busy lock come with it, and nothing else), with the
 * kit's Buttons in the footer. The same three actions, the same words in
 * sentence case, the same note.
 */
export default function LessonOutlinePopup({
  proposalData,
  onGenerate,
  onRefresh,
  onCancel,
  loading,
}) {
  const isSingleSubject = proposalData.mode === 'single_subject'
  const busy = !!loading

  const title = isSingleSubject ? 'New subject' : 'New course'
  const generateLabel = isSingleSubject ? 'Generate subject' : 'Generate course'
  const noteText = isSingleSubject
    ? 'This will generate a full subject with lessons, hotkeys, and web-sourced content using the AI pipeline.'
    : 'This will create a new course with 5-10 subject outlines. After creation, subjects can be filled with content using the Generate All button.'

  return (
    <Dialog
      title={title}
      width="form"
      busy={busy}
      onClose={onCancel}
      footer={(
        <>
          <Button Icon={RotateCcw} onClick={onRefresh} disabled={busy}>Refresh</Button>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" Icon={Play} onClick={onGenerate} loading={busy} loadingLabel="Generating…">
            {generateLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <div className="text-label uppercase text-ink-3 mb-1">
            {isSingleSubject ? 'Topic' : 'Software / language'}
          </div>
          <div className="text-h2 text-ink">
            {isSingleSubject ? proposalData.topic : proposalData.softwareName}
          </div>
        </div>

        {proposalData.description && (
          <div>
            <div className="text-label uppercase text-ink-3 mb-1">Description</div>
            <div className="text-body text-ink-2">{proposalData.description}</div>
          </div>
        )}

        <p className="text-dense text-ink-2 bg-paper-recessed border border-rule rounded-control px-3 py-2">{noteText}</p>
      </div>
    </Dialog>
  )
}
