// =============================================================================
// ShareCourseDialog — Session 11
//
// Opens from the course row's actions menu, in the style of RABBIT's
// EditHistoryDrawer. No new currentView, no new page — the whole sharing model
// (tier + named editors + the admin-only company-standard designation) lives in
// one dialog hung off a row that was already there.
//
// THE RULE THAT SHAPES THIS FILE: fn_otter_pin_course_identity SILENTLY REVERTS
// a visibility change it will not allow — the UPDATE succeeds, the row simply
// comes back unchanged. So this dialog NEVER renders what it sent. Every write
// re-reads the row from the response and calls onCourseChanged with that, and
// a reverted tier surfaces as an explicit message rather than a phantom
// success. Optimistic UI is actively unsafe here.
//
// UX LAWS APPLIED
//   Law of Common Region  Two bounded panels — "Who can see this" and "Who can
//                         edit it" — because they are genuinely different
//                         questions with different rules.
//   Chunking              Each tier carries one plain-language line. Nobody
//                         should have to hold the RLS model in their head.
//   Cognitive Bias        Moving a course OUT of company standard, and removing
//                         an editor, both confirm — they are quietly
//                         consequential and one click from the happy path.
//   Doherty Threshold     Every control shows a pending state; nothing waits
//                         silently on the network.
//   Postel's Law          Accept whatever the server returns as the truth,
//                         including a refusal, and say so in plain words.
//   Peak-End Rule         The dialog closes on a clear confirmation of the new
//                         state rather than just vanishing.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  X, Loader2, Check, AlertCircle, Trash2, UserPlus, ShieldCheck,
  Send, Undo2, MessageSquareWarning,
} from 'lucide-react'
import { otterFetch } from '../adapters'
import { useWorkspaceMembers } from '../../../components/TeamMembers/useWorkspaceMembers'
import {
  VISIBILITY_META, selectableVisibilities, canManageEditors,
} from './otterSharing.js'
import { VisibilityBadge } from './CourseBadges.jsx'

/**
 * Read a response body without letting a non-JSON one destroy the message.
 *
 * Every call here was written `const x = await res.json()` THEN `if (!res.ok)`.
 * otterFetch resolves for every status, so the status check is the only guard —
 * but res.json() runs FIRST and throws on any non-JSON body, which replaces the
 * carefully authored refusal text with `Unexpected token '<', "<!DOCTYPE "...`.
 * That is exactly what a signed-out user hits: PATCH /api/software/:slug is not
 * marked cloudOnly, so it falls through to the local server's HTML 404.
 * Reading defensively puts the status check back in charge.
 */
async function readBody(res) {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

export default function ShareCourseDialog({ course, role, userId, onClose, onCourseChanged }) {
  const wm = useWorkspaceMembers()
  const [editors, setEditors]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(null)   // 'visibility' | `editor:<id>` | 'add'
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)
  const [pick, setPick]         = useState('')
  const [confirmDrop, setConfirmDrop] = useState(null)
  // 0064 — putting the course forward for company standard.
  const [nom, setNom]           = useState(null)    // the caller's live nomination, or null
  const [nomLoading, setNomLoading] = useState(true)
  const [nomBusy, setNomBusy]   = useState(false)
  const [pitch, setPitch]       = useState('')
  const [nomDone, setNomDone]   = useState(null)

  const tiers   = selectableVisibilities(course, role)
  const mayEdit = canManageEditors(course, role)
  const current = course?.visibility ?? 'personal'

  const loadEditors = useCallback(async () => {
    if (!course?.slug) return
    setLoading(true)
    try {
      const res = await otterFetch(`/api/otter/courses/${course.slug}/editors`)
      const data = await readBody(res)
      if (!res.ok) throw new Error(data?.error || 'Could not load edit access')
      setEditors(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [course?.slug])

  useEffect(() => { loadEditors() }, [loadEditors])

  // ── putting the course forward (0064) ─────────────────────────────────────
  // The queue is scoped by RLS to what the caller may see, so a proposer gets
  // their own rows and nothing else. `quiet` suppresses the error banner: after
  // a SUCCESSFUL write, a failed refresh must not read as a failed submit — that
  // invites filing a duplicate, which the partial unique index then refuses.
  const loadNomination = useCallback(async (quiet = false) => {
    if (!course?.slug) return
    setNomLoading(true)
    try {
      const res = await otterFetch('/api/otter/nominations')
      const rows = await readBody(res)
      if (!res.ok) throw new Error(rows?.error || 'Could not check whether this course is put forward')
      const live = (Array.isArray(rows) ? rows : []).find(
        r => r.course_id === course.slug
          && (r.status === 'open' || r.status === 'changes_requested'))
      setNom(live ?? null)
      if (live) setPitch(live.summary ?? '')
    } catch (e) {
      if (!quiet) setError(e.message)
    } finally {
      setNomLoading(false)
    }
  }, [course?.slug])

  useEffect(() => { loadNomination() }, [loadNomination])

  const nomAct = useCallback(async (fn, done) => {
    if (nomBusy) return
    setNomBusy(true); setError(null); setNotice(null); setNomDone(null)
    try {
      await fn()
      setNomDone(done)
      await loadNomination(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setNomBusy(false)
    }
  }, [nomBusy, loadNomination])

  const submitNomination = useCallback(() => {
    const text = pitch.trim()
    if (!text) return
    return nomAct(async () => {
      const res = await otterFetch('/api/otter/nominations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: course.slug, summary: text }),
      })
      const row = await readBody(res)
      if (!res.ok) throw new Error(row?.error || 'Could not put this course forward')
      // Optimistic, so a failed refresh cannot leave the panel offering Submit
      // again on a course that HAS been put forward.
      setNom(prev => prev ?? { id: row?.id, status: 'open', summary: text, revision: 1,
                               course_id: course.slug })
    }, 'Put forward. An admin or a manager will review it.')
  }, [pitch, course?.slug, nomAct])

  // Two jobs behind one button, and they must not be conflated: RESUBMIT moves
  // changes_requested → open and the server bumps the round; SAVE edits the note
  // on a nomination that is already open. Sending `status: 'open'` for a save
  // is a no-op status change that lands in the trigger's else branch — harmless
  // server-side, but the optimistic revision bump below would then invent a
  // round the server never counted.
  const resubmitNomination = useCallback(() => {
    const text = pitch.trim()
    if (!text || !nom) return
    const isResubmit = nom.status === 'changes_requested'
    return nomAct(async () => {
      const res = await otterFetch(`/api/otter/nominations/${nom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isResubmit ? { status: 'open', summary: text } : { summary: text }),
      })
      const row = await readBody(res)
      if (!res.ok) throw new Error(row?.error || (isResubmit ? 'Could not resubmit' : 'Could not save your note'))
      setNom(prev => prev ? {
        ...prev,
        summary: text,
        status: 'open',
        revision: isResubmit ? (prev.revision ?? 1) + 1 : (prev.revision ?? 1),
      } : prev)
    }, isResubmit ? 'Resubmitted — it is back in the review queue.' : 'Note saved.')
  }, [pitch, nom, nomAct])

  const settleNomination = useCallback((status, done) => {
    if (!nom) return
    return nomAct(async () => {
      const res = await otterFetch(`/api/otter/nominations/${nom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const row = await readBody(res)
      if (!res.ok) throw new Error(row?.error || 'Could not record your answer')
      setNom(null)
      setPitch('')
    }, done)
  }, [nom, nomAct])

  // ── visibility ────────────────────────────────────────────────────────────
  const setVisibility = useCallback(async (next) => {
    if (next === current || busy) return
    setBusy('visibility'); setError(null); setNotice(null)
    try {
      const res = await otterFetch(`/api/software/${course.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      })
      const row = await readBody(res)
      if (!res.ok) throw new Error(row?.error || 'Could not change who can see this course')
      // A 200 that carried no readable row cannot be treated as a success:
      // `row.visibility !== next` would be `undefined !== next` and would render
      // the "wasn't allowed" message, while onCourseChanged?.(row) below would
      // no-op on a null slug. Fail loudly instead of guessing which happened.
      if (!row?.slug) throw new Error('The server did not say what happened. Nothing has been changed — try again.')

      // The row is the truth. If the trigger reverted the change, say so —
      // otherwise the user walks away believing they shared something.
      if (row.visibility !== next) {
        setError(
          `That change wasn't allowed, so this course is still "${VISIBILITY_META[row.visibility]?.short ?? row.visibility}". ` +
          (next === 'company_standard' || current === 'company_standard'
            ? 'Only an admin can set or clear the company standard.'
            : 'Only the owner or an admin can change who can see a course.'),
        )
      } else {
        // Say what happens NEXT, not just what the field now reads. A tier is
        // only meaningful as a consequence, and promotion has no review step —
        // it takes effect for everyone the moment it succeeds, so the user
        // should be told that rather than discovering it.
        setNotice(
          next === 'company_standard'
            ? 'Now the company standard — live for everyone straight away. Anyone starting a course on this topic will be offered this instead of generating their own.'
            : next === 'shared'
              // "from here" is only true for an admin. Said to a non-admin it
              // contradicts the panel directly above, which is on screen at the
              // same time (onCourseChanged flips `current` to 'shared') and
              // tells them to go and ask someone.
              ? (role === 'admin'
                  ? 'Now shared with the company. Everyone can read it, and you can make it the company standard from here.'
                  // Since 0064 "go and ask an admin" is the wrong advice, and it
                  // contradicted the submit panel added lower in this same
                  // dialog — the user was handed the old workaround and the new
                  // feature side by side.
                  : 'Now shared with the company. Everyone can read it. To make it the company standard, put it forward below — an admin or a manager decides.')
              : `Now ${VISIBILITY_META[next].label.toLowerCase()}.`,
        )
      }
      onCourseChanged?.(row)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
      setConfirmDrop(null)
    }
  }, [busy, course?.slug, current, onCourseChanged, role])

  const chooseVisibility = useCallback((next) => {
    // Leaving company standard un-blesses the company's official version of a
    // topic for everybody. Worth one confirm; nothing else here is.
    if (current === 'company_standard' && next !== 'company_standard') {
      setConfirmDrop(next)
      return
    }
    setVisibility(next)
  }, [current, setVisibility])

  // ── editor grants ─────────────────────────────────────────────────────────
  const addEditor = useCallback(async () => {
    if (!pick || busy) return
    setBusy('add'); setError(null); setNotice(null)
    try {
      const res = await otterFetch(`/api/otter/courses/${course.slug}/editors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: pick }),
      })
      const data = await readBody(res)
      if (!res.ok) throw new Error(data?.error || 'Could not give edit access')
      setPick('')
      await loadEditors()
      setNotice('Edit access granted.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }, [pick, busy, course?.slug, loadEditors])

  const removeEditor = useCallback(async (uid) => {
    if (busy) return
    setBusy(`editor:${uid}`); setError(null); setNotice(null)
    try {
      const res = await otterFetch(
        `/api/otter/courses/${course.slug}/editors/${encodeURIComponent(uid)}`,
        { method: 'DELETE' })
      const data = await readBody(res)
      if (!res.ok) throw new Error(data?.error || 'Could not remove edit access')
      await loadEditors()
      setNotice('Edit access removed.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }, [busy, course?.slug, loadEditors])

  // Candidates: active members who are neither the owner nor already granted.
  // The owner already has full rights, so offering them is a no-op that would
  // fail the unique constraint and read as an error.
  const granted = new Set(editors.map(e => e.user_id))
  const candidates = (wm.members || []).filter(
    m => m.is_active && m.user_id !== course?.owner_id && !granted.has(m.user_id),
  )

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-stone-800 border-2 border-stone-600 rounded-sm w-[520px] max-h-[80vh] flex flex-col shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)]"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="bg-stone-700 px-4 py-2.5 flex items-center justify-between border-b-2 border-stone-600 shrink-0">
          <div className="min-w-0">
            {/* Matches the menu item that opens it ("Share or submit…") — a
                user who clicked looking for "submit" must land somewhere that
                still uses the word. */}
            <h3 className="text-orange-400 font-bold text-sm uppercase tracking-wide truncate">Share or submit</h3>
            <p className="text-stone-400 text-[11px] truncate">{course?.name}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-600 rounded-sm shrink-0" aria-label="Close">
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ── who can see this ── */}
          <section className="bg-stone-900 border border-stone-700 rounded-sm p-3">
            <h4 className="text-[11px] font-bold text-orange-400 uppercase tracking-wide mb-2">
              Who can see this
            </h4>

            {tiers.length === 0 ? (
              <div className="flex items-center gap-2">
                <VisibilityBadge visibility={current} showPersonal />
                <p className="text-stone-500 text-[11px]">
                  {current === 'company_standard'
                    ? 'Only an admin can change a company standard course.'
                    : 'Only the owner or an admin can change this.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {tiers.map(tier => {
                  const meta = VISIBILITY_META[tier]
                  const active = current === tier
                  const isStandard = tier === 'company_standard'
                  return (
                    <button
                      key={tier}
                      type="button"
                      disabled={busy === 'visibility'}
                      onClick={() => chooseVisibility(tier)}
                      className={`w-full text-left p-2 rounded-sm border-2 transition-colors disabled:opacity-60 ${
                        active
                          ? 'bg-orange-600/15 border-orange-500'
                          : 'bg-stone-950 border-stone-700 hover:border-stone-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${active ? 'text-white' : 'text-stone-300'}`}>
                          {active ? '●' : '○'} {meta.label}
                        </span>
                        {isStandard && <ShieldCheck className="w-3 h-3 text-orange-400" />}
                        {active && busy === 'visibility' && (
                          <Loader2 className="w-3 h-3 animate-spin text-orange-400 ml-auto" />
                        )}
                      </div>
                      <p className="text-stone-500 text-[10px] mt-0.5">{meta.blurb}</p>
                    </button>
                  )
                })}
                {role === 'admin' ? (
                  <p className="text-stone-600 text-[10px] pt-1">
                    Company standard is admin-only, and there can be just one per topic.
                  </p>
                ) : (
                  // PHASE 5 — THIS IS THE ANSWER TO AUDREY'S QUESTION.
                  //
                  // The sentence above was gated on `role === 'admin'`, so the
                  // only explanation of the third tier was shown exclusively to
                  // the people for whom it was not missing. A non-admin owner
                  // saw a two-option list with no hint that a company-standard
                  // tier existed, let alone how to reach it.
                  //
                  // Since 0064 the answer is no longer "go and ask someone".
                  // Anyone may put their own course forward, and an admin or a
                  // manager decides — so this points at the control that does
                  // it rather than describing a conversation to go and have.
                  <div className="pt-2 mt-1 border-t border-stone-800">
                    <p className="text-stone-300 text-[10px] font-bold flex items-center gap-1.5">
                      <ShieldCheck className="w-3 h-3 text-orange-400 shrink-0" />
                      Want this to be the company standard?
                    </p>
                    <p className="text-stone-500 text-[10px] mt-0.5 leading-relaxed">
                      Only an admin or a manager can set that tier — but you can put this
                      course forward for it, at the bottom of this dialog.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── who can edit it ── */}
          <section className="bg-stone-900 border border-stone-700 rounded-sm p-3">
            <h4 className="text-[11px] font-bold text-orange-400 uppercase tracking-wide mb-1">
              Who can edit it
            </h4>
            <p className="text-stone-500 text-[10px] mb-2">
              The owner and workspace admins can always edit. Anyone you add here can too —
              but they cannot add anyone else.
            </p>

            {loading ? (
              <p className="text-stone-500 text-[11px] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </p>
            ) : (
              <>
                {editors.length === 0 ? (
                  <p className="text-stone-600 text-[11px] italic mb-2">No one else has edit access.</p>
                ) : (
                  <ul className="space-y-1 mb-2">
                    {editors.map(ed => (
                      <li
                        key={ed.user_id}
                        className="flex items-center gap-2 bg-stone-950 border border-stone-700 rounded-sm px-2 py-1"
                      >
                        <span className="text-stone-300 text-[11px] truncate flex-1">
                          {ed.label}
                          {!ed.is_active && <span className="text-stone-600 ml-1">(deactivated)</span>}
                        </span>
                        {(mayEdit || ed.user_id === userId) && (
                          <button
                            type="button"
                            onClick={() => removeEditor(ed.user_id)}
                            disabled={!!busy}
                            title={ed.user_id === userId ? 'Give back your edit access' : 'Remove edit access'}
                            className="p-0.5 text-stone-600 hover:text-red-400 transition-colors disabled:opacity-50"
                          >
                            {busy === `editor:${ed.user_id}`
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {mayEdit ? (
                  <div className="flex gap-2">
                    <select
                      value={pick}
                      onChange={e => setPick(e.target.value)}
                      disabled={!!busy || candidates.length === 0}
                      className="flex-1 bg-stone-950 text-white border-2 border-stone-600 rounded-sm px-2 py-1 text-[11px] focus:border-orange-500 disabled:opacity-50"
                    >
                      <option value="">
                        {candidates.length === 0 ? 'Everyone already has access' : 'Choose someone…'}
                      </option>
                      {candidates.map(m => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.display_name || m.username}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addEditor}
                      disabled={!pick || !!busy}
                      className="px-2.5 py-1 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 transition-colors text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"
                    >
                      {busy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                      Add
                    </button>
                  </div>
                ) : (
                  <p className="text-stone-600 text-[10px] italic">
                    Only this course&apos;s owner can give someone edit access to a personal course.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ── put it forward as the company standard (0064) ──
              THE ANSWER TO "how does a user submit a course to be part of the
              company wide otter tool?". Shown for any course the caller owns
              that is not already the standard — including an admin's, who could
              set the tier directly above but may still want it reviewed.
              Submitting opens this course to admins and managers, read-only,
              until the nomination is decided; that consent is the whole reason
              the window exists, so it is stated on the control itself. */}
          {/* `|| nom`: an admin owner can put their own course forward and then
              set the tier directly from the picker above. Gating solely on
              `current !== 'company_standard'` unmounted the panel at that
              moment — taking the Withdraw button with it — and left an open
              nomination in every approver's queue, pointing at a course that
              already IS the standard, with no reachable control to clear it. */}
          {(current !== 'company_standard' || !!nom) && course?.is_own !== false && (
            <section className="bg-stone-900 border border-stone-700 rounded-sm p-3">
              <h4 className="text-[11px] font-bold text-orange-400 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Put it forward as the company standard
              </h4>

              {nomLoading ? (
                <p className="text-stone-500 text-[11px] flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </p>
              ) : nom ? (
                <>
                  {nom.status === 'changes_requested' ? (
                    <div className="bg-stone-950 border border-orange-700/60 rounded-sm p-2.5 mb-2">
                      <p className="text-orange-400 text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                        <MessageSquareWarning className="w-3.5 h-3.5" />
                        {nom.reviewer_label ?? 'A reviewer'} asked for changes
                        {(nom.revision ?? 1) > 1 ? ` (round ${nom.revision})` : ''}
                      </p>
                      <p className="text-stone-200 text-[12px] whitespace-pre-wrap mb-1">
                        “{nom.review_note}”
                      </p>
                      <p className="text-stone-500 text-[10px]">
                        Improve the course, update the note below, and resubmit — or accept
                        the decision to close it.
                      </p>
                    </div>
                  ) : (
                    <p className="text-stone-500 text-[10px] mb-2">
                      Put forward and waiting on a reviewer
                      {(nom.revision ?? 1) > 1 ? ` · round ${nom.revision}` : ''}. You can edit
                      the note below, or withdraw it.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-stone-500 text-[10px] mb-2 leading-relaxed">
                  Anyone can put a course forward. An admin or a manager decides. While it is
                  under review they can open this course read-only, even if it is just for
                  you — that access ends when the nomination is decided.
                </p>
              )}

              {/* Already the standard, but a nomination is still open: nothing
                  left to submit, everything left to tidy up. */}
              {!nomLoading && current === 'company_standard' && nom && (
                <div className="flex items-center gap-2">
                  <p className="text-stone-400 text-[10px] flex-1">
                    This course is already the company standard, so there is nothing left to
                    put forward — but your nomination is still open in the review queue.
                  </p>
                  <button
                    type="button"
                    onClick={() => settleNomination('withdrawn', 'Withdrawn.')}
                    disabled={nomBusy}
                    className="shrink-0 px-2.5 py-1.5 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {nomBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    Withdraw
                  </button>
                </div>
              )}

              {!nomLoading && current !== 'company_standard' && (
                <>
                  <textarea
                    value={pitch}
                    onChange={e => setPitch(e.target.value)}
                    disabled={nomBusy}
                    placeholder="Why should this be the company's official course on this topic?"
                    className="w-full h-20 bg-stone-950 text-white border-2 border-stone-600 rounded-sm p-2 text-[11px] resize-none focus:border-orange-500 placeholder-stone-600 disabled:opacity-60"
                  />
                  <div className="flex justify-between items-center mt-1 mb-2">
                    <span className="text-stone-600 text-[10px]">
                      This is what the reviewer reads first.
                    </span>
                    <span className={`text-[10px] ${pitch.length > 4000 ? 'text-red-400' : 'text-stone-600'}`}>
                      {pitch.length} / 4000
                    </span>
                  </div>

                  <div className="flex gap-2">
                    {nom && nom.status === 'changes_requested' && (
                      <button
                        type="button"
                        onClick={() => settleNomination('rejected', 'Closed. You can put it forward again later.')}
                        disabled={nomBusy}
                        className="px-2.5 py-1.5 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" /> Accept the decision
                      </button>
                    )}
                    {nom && nom.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => settleNomination('withdrawn', 'Withdrawn.')}
                        disabled={nomBusy}
                        className="px-2.5 py-1.5 bg-stone-700 text-stone-300 border-2 border-stone-600 rounded-sm hover:bg-stone-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Undo2 className="w-3 h-3" /> Withdraw
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={nom ? resubmitNomination : submitNomination}
                      disabled={nomBusy || !pitch.trim() || pitch.length > 4000}
                      className="px-3 py-1.5 bg-orange-600 text-white border-2 border-orange-700 rounded-sm hover:bg-orange-700 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {nomBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {nom
                        ? (nom.status === 'changes_requested' ? 'Resubmit' : 'Save note')
                        : 'Put it forward'}
                    </button>
                  </div>
                </>
              )}

              {nomDone && !error && (
                <div className="mt-2 bg-green-900/25 border-2 border-green-800 rounded-sm p-2 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  <p className="text-green-300 text-[11px]">{nomDone}</p>
                </div>
              )}
            </section>
          )}

          {error && (
            <div className="bg-red-900/30 border-2 border-red-700 rounded-sm p-2.5 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-300 text-[11px]">{error}</p>
            </div>
          )}
          {notice && !error && (
            <div className="bg-green-900/25 border-2 border-green-800 rounded-sm p-2.5 flex items-center gap-2">
              <Check className="w-4 h-4 text-green-400 shrink-0" />
              <p className="text-green-300 text-[11px]">{notice}</p>
            </div>
          )}
        </div>

        {/* leaving company standard — the one genuinely consequential move */}
        {confirmDrop && (
          <div className="border-t-2 border-stone-600 bg-stone-900 p-3 shrink-0">
            <p className="text-stone-300 text-[11px] mb-2">
              Remove this as the company standard? People will stop being offered it instead of
              generating their own course. Existing copies are not affected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDrop(null)}
                className="flex-1 bg-stone-700 text-stone-300 border-2 border-stone-600 py-1.5 rounded-sm hover:bg-stone-600 text-[11px] font-bold"
              >
                Keep it
              </button>
              <button
                onClick={() => setVisibility(confirmDrop)}
                className="flex-1 bg-orange-600 text-white border-2 border-orange-700 py-1.5 rounded-sm hover:bg-orange-700 text-[11px] font-bold"
              >
                Remove standard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
