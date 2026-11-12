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
  Check, Trash2, UserPlus, ShieldCheck,
  Send, Undo2, MessageSquareWarning,
} from 'lucide-react'
import { otterFetch } from '../adapters'
import { Dialog, Card, Button, IconButton, Select, Banner, Loading, Spinner } from '../../../ui'
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

  // A4: the kit's Dialog at the form width (review O27: 520 on its own
  // backdrop, a hard offset shadow, an orange title, three bordered boxes and
  // no footer). The three sections are kit Cards; the tiers are A3's radio
  // card, stacked as they were; the confirmation that drops the standard tier
  // is the footer, where it sat; a failure is the Dialog's footer error.
  // Q17: Escape and the modal stack; the busy lock while a change is saving.
  return (
    <Dialog
      title="Share or submit"
      subtitle={course?.name}
      width="form"
      busy={!!busy || nomBusy}
      error={error}
      dismissOnBackdrop
      onClose={onClose}
      className="otter-share"
      footer={confirmDrop ? (
        <>
          {/* leaving company standard — the one genuinely consequential move */}
          <p className="otter-share-drop">
            Remove this as the company standard? People will stop being offered it instead of
            generating their own course. Existing copies are not affected.
          </p>
          <Button onClick={() => setConfirmDrop(null)}>Keep it</Button>
          <Button variant="primary" onClick={() => setVisibility(confirmDrop)}>Remove standard</Button>
        </>
      ) : null}
    >
      <div className="otter-share-body">
        {/* ── who can see this ── */}
        <Card title="Who can see this" className="otter-share-card">
          {tiers.length === 0 ? (
            <div className="otter-share-fixed">
              <VisibilityBadge visibility={current} showPersonal />
              <p className="otter-share-text">
                {current === 'company_standard'
                  ? 'Only an admin can change a company standard course.'
                  : 'Only the owner or an admin can change this.'}
              </p>
            </div>
          ) : (
            <div className="otter-share-tiers">
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
                    className="otter-radio-card otter-share-tier"
                    data-selected={active}
                  >
                    <span className="otter-share-tier-head">
                      <span className="otter-share-tier-label">{active ? '●' : '○'} {meta.label}</span>
                      {isStandard && <ShieldCheck className="otter-share-shield" aria-hidden="true" />}
                      {active && busy === 'visibility' && <Spinner size="sm" className="otter-share-tier-busy" />}
                    </span>
                    <span className="otter-radio-desc">{meta.blurb}</span>
                  </button>
                )
              })}
              {role === 'admin' ? (
                <p className="otter-form-hint">
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
                <div className="otter-share-want">
                  <p className="otter-share-want-title">
                    <ShieldCheck className="otter-share-shield" aria-hidden="true" />
                    Want this to be the company standard?
                  </p>
                  <p className="otter-share-text">
                    Only an admin or a manager can set that tier — but you can put this
                    course forward for it, at the bottom of this dialog.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── who can edit it ── */}
        <Card title="Who can edit it" className="otter-share-card">
          <p className="otter-share-text otter-share-lead">
            The owner and workspace admins can always edit. Anyone you add here can too —
            but they cannot add anyone else.
          </p>

          {loading ? (
            <Loading label="Loading…" />
          ) : (
            <>
              {editors.length === 0 ? (
                <p className="otter-share-text otter-share-lead">No one else has edit access.</p>
              ) : (
                <ul className="otter-share-editors">
                  {editors.map(ed => (
                    <li key={ed.user_id} className="otter-share-editor">
                      <span className="otter-share-editor-name">
                        {ed.label}
                        {!ed.is_active && <span className="otter-share-editor-off"> (deactivated)</span>}
                      </span>
                      {(mayEdit || ed.user_id === userId) && (
                        <IconButton
                          size="sm"
                          danger
                          icon={busy === `editor:${ed.user_id}` ? Spinner : Trash2}
                          onClick={() => removeEditor(ed.user_id)}
                          disabled={!!busy}
                          title={ed.user_id === userId ? 'Give back your edit access' : 'Remove edit access'}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {mayEdit ? (
                <div className="otter-share-add">
                  <Select
                    value={pick}
                    onChange={(v) => setPick(v ?? '')}
                    disabled={!!busy || candidates.length === 0}
                    placeholder={candidates.length === 0 ? 'Everyone already has access' : 'Choose someone…'}
                    options={candidates.map(m => ({ value: m.user_id, label: m.display_name || m.username }))}
                    aria-label="Someone to give edit access"
                    size="sm"
                    className="otter-share-pick"
                  />
                  <Button size="sm" icon={UserPlus} onClick={addEditor} disabled={!pick || !!busy} loading={busy === 'add'}>
                    Add
                  </Button>
                </div>
              ) : (
                <p className="otter-share-text">
                  Only this course&apos;s owner can give someone edit access to a personal course.
                </p>
              )}
            </>
          )}
        </Card>

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
          <Card
            title={<><ShieldCheck className="otter-share-shield" aria-hidden="true" /> Put it forward as the company standard</>}
            className="otter-share-card otter-share-nominate"
          >
            {nomLoading ? (
              <Loading label="Loading…" />
            ) : nom ? (
              <>
                {nom.status === 'changes_requested' ? (
                  <div className="otter-req-feedback">
                    <p className="otter-req-feedback-label">
                      <MessageSquareWarning aria-hidden="true" />
                      {nom.reviewer_label ?? 'A reviewer'} asked for changes
                      {(nom.revision ?? 1) > 1 ? ` (round ${nom.revision})` : ''}
                    </p>
                    <p className="otter-req-feedback-text">“{nom.review_note}”</p>
                    <p className="otter-cr-hint">
                      Improve the course, update the note below, and resubmit — or accept
                      the decision to close it.
                    </p>
                  </div>
                ) : (
                  <p className="otter-share-text otter-share-lead">
                    Put forward and waiting on a reviewer
                    {(nom.revision ?? 1) > 1 ? ` · round ${nom.revision}` : ''}. You can edit
                    the note below, or withdraw it.
                  </p>
                )}
              </>
            ) : (
              <p className="otter-share-text otter-share-lead">
                Anyone can put a course forward. An admin or a manager decides. While it is
                under review they can open this course read-only, even if it is just for
                you — that access ends when the nomination is decided.
              </p>
            )}

            {/* Already the standard, but a nomination is still open: nothing
                left to submit, everything left to tidy up. */}
            {!nomLoading && current === 'company_standard' && nom && (
              <div className="otter-share-tidy">
                <p className="otter-share-text">
                  This course is already the company standard, so there is nothing left to
                  put forward — but your nomination is still open in the review queue.
                </p>
                <Button size="sm" icon={Undo2} onClick={() => settleNomination('withdrawn', 'Withdrawn.')} loading={nomBusy}>
                  Withdraw
                </Button>
              </div>
            )}

            {!nomLoading && current !== 'company_standard' && (
              <>
                <textarea
                  value={pitch}
                  onChange={e => setPitch(e.target.value)}
                  disabled={nomBusy}
                  placeholder="Why should this be the company's official course on this topic?"
                  aria-label="Why this course should be the standard"
                  className="ui-input otter-share-pitch"
                  data-surface="dark"
                />
                <div className="otter-cr-meta">
                  <span>This is what the reviewer reads first.</span>
                  <span className="otter-cr-count" data-over={pitch.length > 4000}>{pitch.length} / 4000</span>
                </div>

                <div className="otter-share-actions">
                  {nom && nom.status === 'changes_requested' && (
                    <Button size="sm" icon={Check} onClick={() => settleNomination('rejected', 'Closed. You can put it forward again later.')} disabled={nomBusy}>
                      Accept the decision
                    </Button>
                  )}
                  {nom && nom.status === 'open' && (
                    <Button size="sm" icon={Undo2} onClick={() => settleNomination('withdrawn', 'Withdrawn.')} disabled={nomBusy}>
                      Withdraw
                    </Button>
                  )}
                  <span className="otter-cr-spacer" aria-hidden="true" />
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Send}
                    onClick={nom ? resubmitNomination : submitNomination}
                    disabled={!pitch.trim() || pitch.length > 4000}
                    loading={nomBusy}
                  >
                    {nom
                      ? (nom.status === 'changes_requested' ? 'Resubmit' : 'Save note')
                      : 'Put it forward'}
                  </Button>
                </div>
              </>
            )}

            {nomDone && !error && (
              <Banner tone="success" icon={Check} className="otter-cr-done otter-share-done">{nomDone}</Banner>
            )}
          </Card>
        )}

        {notice && !error && (
          <Banner tone="success" icon={Check} className="otter-cr-done">{notice}</Banner>
        )}
      </div>
    </Dialog>
  )
}
