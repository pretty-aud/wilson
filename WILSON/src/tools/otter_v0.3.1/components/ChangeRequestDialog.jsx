// =============================================================================
// ChangeRequestDialog — Session 11
//
// The SUBMIT half of change requests, as a dialog inside O.T.T.E.R. The REVIEW
// half lives in the Admin Terminal (Audrey, 2026-07-29: reviewing is admin work
// and belongs where admin work lives — it also keeps O.T.T.E.R.'s layout
// untouched).
//
// WHAT A REVIEWER ACTUALLY SEES — and why this dialog says so out loud:
//
// A fork is born PERSONAL and owned by the person who took it (otter_fork_course
// hardcodes that, so taking a copy can never republish anything). An admin
// therefore cannot read the forked course at all. 0022's own note calls the
// written summary "the review surface", and that is literally true: the summary
// is the only thing that crosses.
//
// Audrey's phrasing was "their updates plus a written explanation", which reads
// as though reviewers would see the changes themselves. Rather than quietly
// shipping the narrower thing, the dialog states the limit in plain words and
// offers the one honest way to close the gap — sharing the forked copy — using
// the visibility control that already exists. No new server mechanism, and the
// user decides whether their working copy becomes visible.
//
// UX LAWS APPLIED
//   Mental Model        Framed as "suggest a change to the official course",
//                       not as a database row with a status column.
//   Cognitive Load      One textarea, one optional checkbox. The rules about
//                       who decides are stated once, where they matter.
//   Zeigarnik Effect    An open request is shown with its status so an
//                       unfinished thread stays visible instead of being lost.
//   Postel's Law        A settled request cannot be reopened — the trigger
//                       raises, and that message is surfaced verbatim because
//                       it is already written for a person.
//   Goal-Gradient       Live character count against the 4000-char limit, so
//                       the write does not fail at submit time.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, AlertCircle, Check, Send, Undo2 } from 'lucide-react'
import { otterFetch } from '../adapters'

const SUMMARY_MAX = 4000   // otter_cr_summary_chk

export default function ChangeRequestDialog({ course, standardName, onClose, onCourseChanged }) {
  const [existing, setExisting] = useState(null)
  const [summary, setSummary]   = useState('')
  const [shareToo, setShareToo] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)

  const targetId = course?.source_course_id ?? null

  // Is there already an open request from this fork? Refining beats filing a
  // second one an admin then has to reconcile.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await otterFetch('/api/otter/change-requests')
      const rows = await res.json()
      if (!res.ok) throw new Error(rows?.error || 'Could not load change requests')
      const open = (Array.isArray(rows) ? rows : []).find(
        r => r.source_course_id === course?.slug && r.status === 'open')
      setExisting(open ?? null)
      if (open) setSummary(open.summary ?? '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [course?.slug])

  useEffect(() => { load() }, [load])

  const shareFork = useCallback(async () => {
    const res = await otterFetch(`/api/software/${course.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'shared' }),
    })
    const row = await res.json()
    if (!res.ok) throw new Error(row?.error || 'Could not share your copy')
    // Render what came back, never what we sent — the pin trigger can revert.
    onCourseChanged?.(row)
    return row.visibility === 'shared'
  }, [course?.slug, onCourseChanged])

  const submit = useCallback(async () => {
    const text = summary.trim()
    if (!text || busy) return
    setBusy(true); setError(null)
    try {
      let sharedOk = true
      if (shareToo && course?.visibility === 'personal') sharedOk = await shareFork()

      if (existing) {
        const res = await otterFetch(`/api/otter/change-requests/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: text }),
        })
        const row = await res.json()
        if (!res.ok) throw new Error(row?.error || 'Could not update your request')
        setDone('Your request has been updated.')
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
      }
      if (!sharedOk) {
        setError('Your request was saved, but your copy could not be shared — it is still private.')
      }
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [summary, busy, shareToo, course, existing, targetId, shareFork, load])

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
          {!targetId && (
            <div className="bg-stone-900 border border-stone-700 rounded-sm p-3">
              <p className="text-stone-400 text-[11px]">
                This course wasn&apos;t copied from a company standard, so there is nothing to
                suggest a change to. Start from a company standard course and you can send your
                improvements back.
              </p>
            </div>
          )}

          {targetId && (
            <>
              {loading ? (
                <p className="text-stone-500 text-[11px] flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </p>
              ) : (
                <>
                  {existing && (
                    <div className="bg-stone-900 border border-orange-700/50 rounded-sm p-2.5">
                      <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wide mb-0.5">
                        You already have a request open
                      </p>
                      <p className="text-stone-500 text-[10px]">
                        Edit it below and save, or withdraw it. Once an admin decides, it is final.
                      </p>
                    </div>
                  )}

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
                        This is what the reviewer reads.
                      </span>
                      <span className={`text-[10px] ${tooLong ? 'text-red-400' : 'text-stone-600'}`}>
                        {summary.length} / {SUMMARY_MAX}
                      </span>
                    </div>
                  </div>

                  {/* The honest limit, stated where it matters. */}
                  <div className="bg-stone-900 border border-stone-700 rounded-sm p-2.5">
                    <p className="text-stone-400 text-[10px] leading-relaxed">
                      Your copy of this course is private — reviewers see the note above, not the
                      course itself.
                    </p>
                    {course?.visibility === 'personal' && (
                      <label className="flex items-start gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shareToo}
                          onChange={e => setShareToo(e.target.checked)}
                          disabled={busy}
                          className="mt-0.5 accent-orange-600"
                        />
                        <span className="text-stone-300 text-[11px]">
                          Also share my copy with the company, so reviewers can open it and see the
                          changes for themselves.
                        </span>
                      </label>
                    )}
                    {course?.visibility !== 'personal' && (
                      <p className="text-stone-500 text-[10px] mt-1">
                        Your copy is already shared, so reviewers can open it.
                      </p>
                    )}
                  </div>
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

        {targetId && !loading && (
          <div className="border-t-2 border-stone-600 p-3 flex gap-2 shrink-0">
            {existing && (
              <button
                onClick={withdraw}
                disabled={busy}
                className="px-3 py-2 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Undo2 className="w-3 h-3" /> Withdraw
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-3 py-2 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold"
            >
              Close
            </button>
            <button
              onClick={submit}
              disabled={busy || !summary.trim() || tooLong}
              className="px-4 py-2 bg-orange-600 text-white border-2 border-orange-700 rounded-sm hover:bg-orange-700 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {existing ? 'Save changes' : 'Send to admin'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
