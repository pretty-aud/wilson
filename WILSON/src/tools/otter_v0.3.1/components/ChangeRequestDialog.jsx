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
import { X, Loader2, AlertCircle, Check, Send, Undo2, MessageSquareWarning } from 'lucide-react'
import { otterFetch } from '../adapters'

const SUMMARY_MAX = 4000   // otter_cr_summary_chk

export default function ChangeRequestDialog({ course, standardName, sourceIsStandard = false, onClose }) {
  const [existing, setExisting] = useState(null)
  const [summary, setSummary]   = useState('')
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)

  const targetId = course?.source_course_id ?? null
  const isDeclined = existing?.status === 'changes_requested'

  // MAY A REQUEST BE FILED OR RESUBMITTED AGAINST THIS TARGET?
  //
  // Being a fork is necessary but not sufficient. otter_cr_insert (0025) also
  // requires the target to be company_standard RIGHT NOW, and a standard can be
  // demoted underneath an existing fork — by hand via ShareCourseDialog's
  // confirmDrop, or automatically whenever a nomination is approved (0064).
  // Until this gate existed the whole submit form rendered in that state and the
  // user only learned at POST time, having written the summary.
  //
  // This is deliberately NOT the whole dialog. otter_cr_update gates on WHO the
  // caller is and never on the target's visibility, so withdrawing an open
  // request and accepting a decline both still work after a demotion — hiding
  // them would strand a proposer with a request they cannot close.
  const canPropose = !!targetId && sourceIsStandard

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

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-stone-800 border-2 border-stone-600 rounded-sm w-[560px] max-h-[80vh] flex flex-col shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-stone-700 px-4 py-2.5 flex items-center justify-between border-b-2 border-stone-600 shrink-0">
          <div className="min-w-0">
            <h3 className="text-orange-400 font-bold text-sm uppercase tracking-wide">Suggest a change</h3>
            <p className="text-stone-400 text-[11px] truncate">
              to the company standard{standardName ? `: ${standardName}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-600 rounded-sm shrink-0" aria-label="Close">
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Widened from `!targetId`. There are two ways to have no target —
              never forked from a standard, and forked from one that has since
              stood down — and the second is the common one now that approving a
              nomination demotes the incumbent. Naming which it is matters: the
              first is a fact about the user's course, the second is a thing that
              happened TO it, and telling someone their course "wasn't copied
              from a company standard" when it demonstrably was reads as a bug. */}
          {!canPropose && (
            <div className="bg-stone-900 border border-stone-700 rounded-sm p-3">
              {!targetId ? (
                <p className="text-stone-400 text-[11px]">
                  This course wasn&apos;t copied from a company standard, so there is nothing to
                  suggest a change to. Start from a company standard course and you can send your
                  improvements back.
                </p>
              ) : (
                <p className="text-stone-400 text-[11px]">
                  {standardName ? `“${standardName}”` : 'The course this was copied from'} is no
                  longer the company standard, so there is nothing to suggest a change to. Your
                  copy is unaffected — it is still yours, and nothing in it has changed. If
                  another course has taken its place as the standard, take a copy of that one
                  and you can suggest changes there.
                </p>
              )}
            </div>
          )}

          {(canPropose || existing) && (
            <>
              {loading ? (
                <p className="text-stone-500 text-[11px] flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </p>
              ) : (
                <>
                  {/* The admin answered: their note, then two ways forward. */}
                  {isDeclined && (
                    <div className="bg-stone-900 border border-orange-700/60 rounded-sm p-3">
                      <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                        <MessageSquareWarning className="w-3.5 h-3.5" />
                        {existing.reviewer_label ?? 'An admin'} asked for changes
                        {(existing.revision ?? 1) > 1 ? ` (round ${existing.revision})` : ''}
                      </p>
                      <p className="text-stone-200 text-[12px] whitespace-pre-wrap mb-2">
                        “{existing.review_note}”
                      </p>
                      <p className="text-stone-500 text-[10px]">
                        Edit your course to address the note, update the summary below, and
                        resubmit — or accept the decision to close the request.
                      </p>
                    </div>
                  )}

                  {existing && !isDeclined && (
                    <div className="bg-stone-900 border border-orange-700/50 rounded-sm p-2.5">
                      <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wide mb-0.5">
                        You already have a request open
                        {(existing.revision ?? 1) > 1 ? ` (round ${existing.revision})` : ''}
                      </p>
                      <p className="text-stone-500 text-[10px]">
                        Edit it below and save, or withdraw it. An admin decides from here.
                      </p>
                    </div>
                  )}

                  {/* The write half, and ONLY the write half, is gated. The two
                      banners above stay visible after a demotion because a
                      proposer with a live request still needs to see its state
                      to withdraw it or accept the decline. */}
                  {canPropose && (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-orange-400 mb-1 uppercase tracking-wide">
                          What did you change, and why?
                        </label>
                        <textarea
                          value={summary}
                          onChange={e => setSummary(e.target.value)}
                          disabled={busy}
                          placeholder="e.g. The keyboard shortcuts section is out of date since 4.2 — I corrected the modifier keys and added the new snapping tools."
                          className="w-full h-36 bg-stone-950 text-white border-2 border-stone-600 rounded-sm p-3 text-sm resize-none focus:border-orange-500 focus:outline-none placeholder-stone-600"
                        />
                        <div className="flex justify-between mt-1">
                          <span className="text-stone-600 text-[10px]">
                            This is what the reviewer reads first.
                          </span>
                          <span className={`text-[10px] ${tooLong ? 'text-red-400' : 'text-stone-600'}`}>
                            {summary.length} / {SUMMARY_MAX}
                          </span>
                        </div>
                      </div>

                      {/* The review window, stated once (Session 13 — the "also
                          share my copy" checkbox is gone because this replaced it). */}
                      <div className="bg-stone-900 border border-stone-700 rounded-sm p-2.5">
                        <p className="text-stone-400 text-[10px] leading-relaxed">
                          Submitting lets reviewers open your copy of this course, read-only, while
                          the request is under review. That access ends when the request is decided.
                          If it is approved, your changes are added to the standard course — nothing
                          is ever deleted from it, and its hotkey/function/node references stay as
                          they are.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {error && (
            <div className="bg-red-900/30 border-2 border-red-700 rounded-sm p-2.5 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-300 text-[11px]">{error}</p>
            </div>
          )}
          {done && !error && (
            <div className="bg-green-900/25 border-2 border-green-800 rounded-sm p-2.5 flex items-center gap-2">
              <Check className="w-4 h-4 text-green-400 shrink-0" />
              <p className="text-green-300 text-[11px]">{done}</p>
            </div>
          )}
        </div>

        {/* `canPropose || existing`, not `targetId`: after a demotion there is
            nothing to propose but a live request still has to be closable. */}
        {(canPropose || existing) && !loading && (
          <div className="border-t-2 border-stone-600 p-3 flex gap-2 shrink-0">
            {existing && !isDeclined && (
              <button
                onClick={withdraw}
                disabled={busy}
                className="px-3 py-2 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Undo2 className="w-3 h-3" /> Withdraw
              </button>
            )}
            {isDeclined && (
              <button
                onClick={acceptDecision}
                disabled={busy}
                className="px-3 py-2 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Check className="w-3 h-3" /> Accept the decision
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-3 py-2 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold"
            >
              Close
            </button>
            {canPropose && (
              <button
                onClick={submit}
                disabled={busy || !summary.trim() || tooLong}
                className="px-4 py-2 bg-orange-600 text-white border-2 border-orange-700 rounded-sm hover:bg-orange-700 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {isDeclined ? 'Resubmit with changes' : existing ? 'Save changes' : 'Send to admin'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
