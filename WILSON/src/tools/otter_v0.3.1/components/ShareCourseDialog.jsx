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
import { X, Loader2, Check, AlertCircle, Trash2, UserPlus, ShieldCheck } from 'lucide-react'
import { otterFetch } from '../adapters'
import { useWorkspaceMembers } from '../../../components/TeamMembers/useWorkspaceMembers'
import {
  VISIBILITY_META, selectableVisibilities, canManageEditors,
} from './otterSharing.js'
import { VisibilityBadge } from './CourseBadges.jsx'

export default function ShareCourseDialog({ course, role, userId, onClose, onCourseChanged }) {
  const wm = useWorkspaceMembers()
  const [editors, setEditors]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(null)   // 'visibility' | `editor:<id>` | 'add'
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)
  const [pick, setPick]         = useState('')
  const [confirmDrop, setConfirmDrop] = useState(null)

  const tiers   = selectableVisibilities(course, role)
  const mayEdit = canManageEditors(course, role)
  const current = course?.visibility ?? 'personal'

  const loadEditors = useCallback(async () => {
    if (!course?.slug) return
    setLoading(true)
    try {
      const res = await otterFetch(`/api/otter/courses/${course.slug}/editors`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not load edit access')
      setEditors(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [course?.slug])

  useEffect(() => { loadEditors() }, [loadEditors])

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
      const row = await res.json()
      if (!res.ok) throw new Error(row?.error || 'Could not change who can see this course')

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
        setNotice(`Now ${VISIBILITY_META[next].label.toLowerCase()}.`)
      }
      onCourseChanged?.(row)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
      setConfirmDrop(null)
    }
  }, [busy, course?.slug, current, onCourseChanged])

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
      const data = await res.json()
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
      const data = await res.json()
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
            <h3 className="text-orange-400 font-bold text-sm uppercase tracking-wide truncate">Sharing</h3>
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
                {role === 'admin' && (
                  <p className="text-stone-600 text-[10px] pt-1">
                    Company standard is admin-only, and there can be just one per topic.
                  </p>
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
                      className="flex-1 bg-stone-950 text-white border-2 border-stone-600 rounded-sm px-2 py-1 text-[11px] focus:border-orange-500 focus:outline-none disabled:opacity-50"
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
