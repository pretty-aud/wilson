// =============================================================================
// ChangeRequestDialog — Session 11; Session 13 adds the decision state.
//
// The SUBMIT half of change requests, as a dialog inside O.T.T.E.R. The REVIEW
// half lives in the Admin Terminal (Audrey, 2026-07-29: reviewing is admin work
// and belongs where admin work lives — it also keeps O.T.T.E.R.'s layout
// untouched).
//
// SESSION 13 (locked #22 + migration 0025) — what changed for the proposer:
//
//   * SUBMITTING SHARES YOUR COPY WITH REVIEWERS, read-only, for as long as
//     the request is open. That is a consented review window the server
//     enforces (0025), so the S11 "also share my copy with the company"
//     checkbox is GONE — it solved a problem that no longer exists, and its
//     presence would imply sharing is still required.
//   * A DECLINE COMES BACK AS A CONVERSATION. The admin's note (required on
//     their side) shows here, and there are exactly two ways forward: make
//     the changes and resubmit (the request reopens at round N+1), or accept
//     the decision (it closes for good).
//   * APPROVAL APPLIES. If the admin approves, their side archives the
//     standard and copies your subjects into it — nothing for this dialog to
//     do but say so.
//
// UX LAWS APPLIED (Session 13 pass)
//   Zeigarnik Effect    A changes_requested request is unfinished work for
//                       the PROPOSER. It surfaces here, loudly, with the
//                       admin's note — not only in the admin queue.
//   Postel's Law        The decline is rendered as a conversation with two
//                       clear ways forward, and every server refusal is
//                       surfaced verbatim (they are written for people).
//   Mental Model        Pull-request vocabulary: request changes, revise,
//                       resubmit, round N. Nothing invented.
//   Hick's Law          The decision state offers exactly two actions.
//   Cognitive Load      One textarea. The review-window rule is stated once,
//                       in one sentence, where it matters.
//   Goal-Gradient       Live character count against the 4000-char limit, so
//                       the write does not fail at submit time.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Check, Send, Undo2, MessageSquareWarning } from 'lucide-react'
import { otterFetch } from '../adapters'
import { Dialog, Button, Banner, Loading } from '../../../ui'

const SUMMARY_MAX = 4000   // otter_cr_summary_chk

export default function ChangeRequestDialog({ course, standardName, onClose }) {
  const [existing, setExisting] = useState(null)
  const [summary, setSummary]   = useState('')
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)

  const targetId = course?.source_course_id ?? null
  const isDeclined = existing?.status === 'changes_requested'

  // Is there already a LIVE request from this fork? Open means refine or
  // withdraw; changes_requested means the admin answered and it is the
  // proposer's move (Zeigarnik: the unfinished thread surfaces here).
  // `quiet` suppresses the error banner: after a SUCCESSFUL write, a failed
  // list refresh must not render as a failed submit — that invites filing a
  // duplicate request (found by the S13 review). Returns whether it loaded.
  const load = useCallback(async (quiet = false) => {
    setLoading(true)
    try {
      const res = await otterFetch('/api/otter/change-requests')
      const rows = await res.json()
      if (!res.ok) throw new Error(rows?.error || 'Could not load change requests')
      const live = (Array.isArray(rows) ? rows : []).find(
        r => r.source_course_id === course?.slug
          && (r.status === 'open' || r.status === 'changes_requested'))
      setExisting(live ?? null)
      if (live) setSummary(live.summary ?? '')
      return true
    } catch (e) {
      if (!quiet) setError(e.message)
      return false
    } finally {
      setLoading(false)
    }
  }, [course?.slug])

  useEffect(() => { load() }, [load])

  // Submit a new request, save an open one, or — from the declined state —
  // resubmit (status back to 'open'; the server bumps the revision).
  const submit = useCallback(async () => {
    const text = summary.trim()
    if (!text || busy) return
    setBusy(true); setError(null)
    try {
      if (existing) {
        const res = await otterFetch(`/api/otter/change-requests/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isDeclined ? { status: 'open', summary: text } : { summary: text }),
        })
        const row = await res.json()
        if (!res.ok) throw new Error(row?.error || 'Could not update your request')
        setDone(isDeclined
          ? 'Resubmitted — it is back in the review queue.'
          : 'Your request has been updated.')
        // Optimistic state, so a failed refresh below cannot leave the dialog
        // showing the pre-write status (the server row HAS moved).
        setExisting(prev => prev ? {
          ...prev,
          status: 'open',
          summary: text,
          revision: isDeclined ? (prev.revision ?? 1) + 1 : (prev.revision ?? 1),
        } : prev)
      } else {
        const res = await otterFetch('/api/otter/change-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_course_id: targetId,
            source_course_id: course?.slug ?? null,
            summary: text,
          }),
        })
        const row = await res.json()
        if (!res.ok) throw new Error(row?.error || 'Could not send your request')
        setDone('Sent. An admin will review it.')
        // If the refresh below fails, this stub keeps the dialog in its
        // "request open" state so the submit cannot be repeated by accident.
        setExisting(prev => prev ?? {
          id: row.id, status: 'open', summary: text, revision: 1,
          source_course_id: course?.slug ?? null,
        })
      }
      await load(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [summary, busy, course, existing, isDeclined, targetId, load])

  const withdraw = useCallback(async () => {
    if (!existing || busy) return
    setBusy(true); setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'withdrawn' }),
      })
      const row = await res.json()
      if (!res.ok) throw new Error(row?.error || 'Could not withdraw your request')
      setDone('Withdrawn.')
      setExisting(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [existing, busy])

  // "Accept the decision" — the request closes for good (rejected +
  // acknowledged); the review window on this copy closes with it.
  const acceptDecision = useCallback(async () => {
    if (!existing || busy) return
    setBusy(true); setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      const row = await res.json()
      if (!res.ok) throw new Error(row?.error || 'Could not record your answer')
      setDone('Done — the request is closed, and your copy is private again.')
      setExisting(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [existing, busy])

  const tooLong = summary.length > SUMMARY_MAX

  // A4: the kit's Dialog at the form width (review O27; it was 560 on its
  // own backdrop with a hard offset shadow and an orange title). Q17: Escape
  // and the modal stack, and the busy lock while a request is sent — the
  // backdrop still closes it otherwise. A failure is the Dialog's footer
  // error (the kit's contract), where it was a red box in the body.
  return (
    <Dialog
      title="Suggest a change"
      subtitle={`to the company standard${standardName ? `: ${standardName}` : ''}`}
      width="form"
      busy={busy}
      error={error}
      dismissOnBackdrop
      onClose={onClose}
      className="otter-cr"
      footer={targetId && !loading ? (
        <>
          {existing && !isDeclined && (
            <Button icon={Undo2} onClick={withdraw} disabled={busy}>Withdraw</Button>
          )}
          {isDeclined && (
            <Button icon={Check} onClick={acceptDecision} disabled={busy}>Accept the decision</Button>
          )}
          <span className="otter-cr-spacer" aria-hidden="true" />
          <Button onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" icon={Send} onClick={submit} disabled={!summary.trim() || tooLong} loading={busy}>
            {isDeclined ? 'Resubmit with changes' : existing ? 'Save changes' : 'Send to admin'}
          </Button>
        </>
      ) : null}
    >
      <div className="otter-cr-body">
        {!targetId && (
          <p className="otter-cr-note">
            This course wasn&apos;t copied from a company standard, so there is nothing to
            suggest a change to. Start from a company standard course and you can send your
            improvements back.
          </p>
        )}

        {targetId && (
          <>
            {loading ? (
              <Loading label="Loading…" />
            ) : (
              <>
                {/* The admin answered: their note, then two ways forward. */}
                {isDeclined && (
                  <div className="otter-req-feedback">
                    <p className="otter-req-feedback-label">
                      <MessageSquareWarning aria-hidden="true" />
                      {existing.reviewer_label ?? 'An admin'} asked for changes
                      {(existing.revision ?? 1) > 1 ? ` (round ${existing.revision})` : ''}
                    </p>
                    <p className="otter-req-feedback-text">“{existing.review_note}”</p>
                    <p className="otter-cr-hint">
                      Edit your course to address the note, update the summary below, and
                      resubmit — or accept the decision to close the request.
                    </p>
                  </div>
                )}

                {existing && !isDeclined && (
                  <div className="otter-cr-open">
                    <p className="otter-cr-open-label">
                      You already have a request open
                      {(existing.revision ?? 1) > 1 ? ` (round ${existing.revision})` : ''}
                    </p>
                    <p className="otter-cr-hint">
                      Edit it below and save, or withdraw it. An admin decides from here.
                    </p>
                  </div>
                )}

                <div>
                  <label id="otter-cr-summary-label" className="ui-field-label otter-form-label">
                    What did you change, and why?
                  </label>
                  <textarea
                    value={summary}
                    onChange={e => setSummary(e.target.value)}
                    disabled={busy}
                    aria-labelledby="otter-cr-summary-label"
                    placeholder="e.g. The keyboard shortcuts section is out of date since 4.2 — I corrected the modifier keys and added the new snapping tools."
                    className="ui-input otter-cr-textarea"
                    data-surface="dark"
                  />
                  <div className="otter-cr-meta">
                    <span>This is what the reviewer reads first.</span>
                    <span className="otter-cr-count" data-over={tooLong}>
                      {summary.length} / {SUMMARY_MAX}
                    </span>
                  </div>
                </div>

                {/* The review window, stated once (Session 13 — the "also
                    share my copy" checkbox is gone because this replaced it). */}
                <p className="otter-cr-note">
                  Submitting lets reviewers open your copy of this course, read-only, while
                  the request is under review. That access ends when the request is decided.
                  If it is approved, your changes are added to the standard course — nothing
                  is ever deleted from it, and its hotkey/function/node references stay as
                  they are.
                </p>
              </>
            )}
          </>
        )}

        {done && !error && (
          <Banner tone="success" icon={Check} className="otter-cr-done">{done}</Banner>
        )}
      </div>
    </Dialog>
  )
}
