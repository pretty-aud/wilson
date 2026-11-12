// =============================================================================
// NewSubjectShareReminder — B2 (2026-10-27), docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §5.9.
//
// Her ruling (2026-10-27, "No, with a reminder"): a subject added later does
// NOT follow a course that was shared whole. When a run saves subjects the
// course did not hold before, and the course has live batch rows, O.T.T.E.R.
// asks the owner whether to share the new ones with those people too.
// Consent stays explicit; nothing new is written to the database for it.
//
// **Share** makes ORDINARY single rows: `share.create` once per (subject,
// person), in order, stopping at the first refusal with its sentence in the
// footer. The public function takes no batch id, deliberately — a client must
// not be able to file a row into a batch — so the owner's list shows these
// beside the batch line, not inside it. **Not now** closes and writes nothing.
// Once per run: the run's own list is this dialog's memory, and a reload asks
// nothing, because nothing is pending on the server after Not now.
//
// Why a new file: no existing dialog asks this question; Otter.jsx is 5,800
// lines and its own dialogs are render functions over its state, which this
// one does not need (it is handed a plan and reports back).
// =============================================================================

import { useState } from 'react'
import { otterFetch } from '../adapters'
import { Dialog, Button } from '../../../ui'
import {
  shareCall, runShareLoop, reminderPairs, reminderTitle, reminderLine, namesList, sharedSentence,
} from './otterSharing.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const sentence = (t) => (t && !/[.!?]$/.test(t) ? `${t}.` : t)

/**
 * @param {object}   props
 * @param {object}   props.plan     planNewSubjectReminder()'s answer: courseName, people, subjects, held
 * @param {Function} [props.onShared] re-reads the share index after any row was made
 * @param {Function} [props.onDone]   every pair made: the sentence for the library's banner
 */
export default function NewSubjectShareReminder({ plan, fetchImpl = otterFetch, onClose, onShared, onDone }) {
  const [ticked, setTicked] = useState(() => (plan?.people ?? []).map((p) => p.userId))
  // Pairs a previous press already made, so a second press after a refusal
  // does not stop again on "already shared" at the first of them.
  const [made, setMade] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const people = plan?.people ?? []
  const subjects = plan?.subjects ?? []
  const pairs = reminderPairs(plan, ticked).filter((p) => !made.has(`${p.subject.id}|${p.person.userId}`))

  const share = async () => {
    if (busy || pairs.length === 0) return
    setBusy(true)
    setError(null)
    const result = await runShareLoop(pairs, async (pair) => {
      const out = await shareCall(fetchImpl, '/api/otter/subject-shares', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ subject_id: pair.subject.id, shared_with: pair.person.userId, message: null }),
      })
      return { ok: out.ok, text: out.text }
    })
    if (result.done.length) {
      setMade((prev) => new Set([...prev, ...result.done.map((p) => `${p.subject.id}|${p.person.userId}`)]))
      await onShared?.()
    }
    if (result.stoppedAt) {
      const at = result.stoppedAt
      setError(`${at.person.label}, «${at.subject.title}»: ${sentence(result.text)}`)
      setBusy(false)
      return
    }
    const names = people.filter((p) => ticked.includes(p.userId)).map((p) => p.label)
    onDone?.(sharedSentence(names))
  }

  const toggle = (userId) => setTicked((t) => (t.includes(userId) ? t.filter((x) => x !== userId) : [...t, userId]))

  return (
    <Dialog
      title={reminderTitle(subjects.length)}
      width="form"
      busy={busy}
      error={error}
      onClose={onClose}
      className="otter-share"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Not now</Button>
          <Button variant="primary" onClick={share} disabled={busy || pairs.length === 0} loading={busy}>Share</Button>
        </>
      )}
    >
      <div className="otter-share-body">
        <p className="otter-share-text">{reminderLine(plan?.courseName, people.map((p) => p.label))}</p>
        <ul className="otter-share-editors" aria-label="Share with">
          {people.map((p) => {
            const id = `otter-reminder-${p.userId}`
            return (
              <li key={p.userId} className="otter-share-editor">
                <input
                  id={id}
                  type="checkbox"
                  checked={ticked.includes(p.userId)}
                  onChange={() => toggle(p.userId)}
                  disabled={busy}
                />
                <label htmlFor={id} className="otter-share-editor-name">{p.label}</label>
              </li>
            )
          })}
        </ul>
        <p className="otter-share-text">
          New in this course: {namesList(subjects.map((s) => `«${s.title}»`))}.
        </p>
      </div>
    </Dialog>
  )
}
