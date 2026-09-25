// =============================================================================
// RequestsView — change requests INSIDE O.T.T.E.R. (Session 13 follow-up,
// Audrey 2026-07-30: "the admin controls for the company library … make sure
// that view is in the otter app … in the same page a non admin should see the
// requests that they have sent and can review feedback on").
//
// One nav tab, role-aware content — the brief's three APP tiers (admin /
// manager / user; the RABBIT project-level "reviewer" seat is a different
// axis and plays no part here):
//
//   * ADMINS (and OWNERS of a company-standard course, whatever their tier —
//     gap #33, now closed) get the review queue: open requests with the full
//     Approve-and-apply / Decline-with-note controls, plus the decided
//     history. Same server ops as the Admin Terminal's Requests section
//     (cr.list / cr.approve / PATCH changes_requested) — the Terminal surface
//     stays; this is the in-tool home Audrey asked for.
//   * MANAGERS view the queue (0026) but do not decide and get no window
//     into the proposer's fork — their rows render without controls, and the
//     copy says who decides rather than dangling dead buttons.
//   * EVERYONE sees "My requests": what they proposed, its status and round,
//     the admin's feedback verbatim, and the way forward (the
//     ChangeRequestDialog remains the single actuator for edit / accept /
//     resubmit / withdraw, so proposer rules live in exactly one place).
//
// WHO DECIDES is capability math, not role math: admins decide everything;
// anyone decides requests against a standard course THEY OWN (`is_own` from
// the course index). Rows a manager can see but not decide are exactly the
// remainder. All three splits are pinned server-side by pgTAP 32 — the
// client only chooses which controls to draw.
//
// UX LAWS APPLIED
//   Zeigarnik Effect   changes_requested rows sit at the top of "My requests"
//                      with the admin's note in full — unfinished work stays
//                      loud, in the tool the proposer actually uses.
//   Cognitive Bias     Approve writes to the company's canonical course, so
//                      it confirms with real add/update counts, states that
//                      nothing is deleted and reference documents are
//                      untouched, and that an archive is kept first.
//   Mental Model       Pull-request vocabulary everywhere: approve, request
//                      changes, resubmit, round N — same words as the Admin
//                      Terminal and the submit dialog.
//   Working Memory     Summary, proposer, feedback, diff counts and both
//                      actions live in one expanded row; nothing to carry
//                      across screens.
//   Von Restorff       One primary per row (Approve / Review & respond);
//                      everything else is quiet.
//   Postel's Law       Server refusals (trigger, RLS, apply RPC) are shown
//                      verbatim — they are already written for people.
//   Doherty Threshold  Every server round-trip has a busy state on the
//                      control that fired it.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, GitPullRequestArrow, Check, X, AlertCircle, Lock, ChevronRight,
  Eye, EyeOff, Archive, ExternalLink, MessageSquareWarning, ShieldCheck,
} from 'lucide-react'
import { otterFetch } from '../adapters'
import { Button, IconButton, SectionTitle, Banner, Loading, Spinner, StatusBadge, statusMeta } from '../../../ui'

// A4 (review O24): a request's status is the kit's StatusBadge, its tone and
// word from the kit's one STATUS map (open, changes requested, approved,
// rejected, withdrawn — the Admin Terminal's tones). This file's own map
// drew five text colours and five hexes found nowhere else in WILSON.

function fmt(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleString()
}

export default function RequestsView({
  role, userId, softwareList, refreshTick, onOpenCourse, onOpenDialog, onCoursesChanged,
}) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [decide, setDecide]   = useState(null)   // { id, action: 'approve' | 'decline' }
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [diff, setDiff]       = useState(null)
  const [applied, setApplied] = useState(null)   // Peak-End: { name, adds, updates }
  const [showDecided, setShowDecided] = useState(false)
  const diffForRef = useRef(null)
  // ── company-standard nominations (0064) ──
  // Deliberately separate state from `rows`: a nomination is not a change
  // request, the decide-set is wider (admins AND managers), and conflating the
  // two lists would put manager controls on change-request rows — which pgTAP
  // 32 asserts must never work.
  const [noms, setNoms]         = useState([])
  const [nomBusy, setNomBusy]   = useState(false)
  const [nomDecide, setNomDecide] = useState(null)  // { id, action: 'approve' | 'decline' }
  const [nomNote, setNomNote]   = useState('')
  const [promoted, setPromoted] = useState(null)
  const [nomError, setNomError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await otterFetch('/api/otter/change-requests')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not load change requests')
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Nominations keep their OWN error. Writing into the shared `error` was worse
  // than untidy: that banner is worded for change requests, and it gates
  // `{promoted && !error}` — so a transient refresh failure AFTER
  // otter_nomination_apply had already committed replaced the confirmation with
  // "could not load", and the approver would reasonably retry into
  // "nomination is approved — only an open nomination can be approved".
  //
  // Returns the rows so a caller that needs the SETTLED row (approveNom) can
  // read it without waiting for a state flush. `quiet` suppresses the banner
  // after a successful write, for the same reason ChangeRequestDialog does.
  const loadNoms = useCallback(async (quiet = false) => {
    try {
      const res = await otterFetch('/api/otter/nominations')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not load nominations')
      const list = Array.isArray(data) ? data : []
      setNoms(list)
      setNomError(null)
      return list
    } catch (e) {
      if (!quiet) { setNoms([]); setNomError(e.message) }
      return null
    }
  }, [])

  const refreshAll = useCallback(() => { load(); loadNoms() }, [load, loadNoms])

  // The view is conditionally mounted (fresh on every visit), so a load on
  // mount is exactly the lazy-fetch the all-pages shell demands. refreshTick
  // bumps when the ChangeRequestDialog closes: the dialog is the proposer's
  // actuator, and the list behind it must reflect what they just did.
  useEffect(() => { load(); loadNoms() }, [load, loadNoms, refreshTick])

  // Capability split (see header): admins decide everything; anyone decides
  // requests against a standard course they OWN; managers see the rest
  // read-only. Since 0026 a visible row is NOT automatically decidable.
  const isAdmin = role === 'admin'
  const { mine, toReview, watching, decided } = useMemo(() => {
    const ownTargets = new Set(
      (softwareList ?? []).filter(sw => sw.is_own).map(sw => sw.slug))
    const m = [], r = [], w = [], d = []
    for (const row of rows) {
      const canDecide = isAdmin || ownTargets.has(row.target_course_id)
      if (row.proposed_by === userId) m.push(row)
      else if (row.status === 'open') (canDecide ? r : w).push(row)
      else d.push(row)
    }
    // Zeigarnik: the rows waiting on ME first, then live ones, then history.
    const rank = s => (s === 'changes_requested' ? 0 : s === 'open' ? 1 : 2)
    m.sort((a, b) => rank(a.status) - rank(b.status))
    return { mine: m, toReview: r, watching: w, decided: d }
  }, [rows, userId, isAdmin, softwareList])

  // ── reviewer actions (parity with the Admin Terminal section) ─────────────

  const loadDiff = useCallback(async (r) => {
    diffForRef.current = r.id
    setDiff({ loading: true })
    try {
      const [srcRes, tgtRes] = await Promise.all([
        otterFetch(`/api/software/${r.source_course_id}/subjects`),
        otterFetch(`/api/software/${r.target_course_id}/subjects`),
      ])
      const src = await srcRes.json()
      const tgt = await tgtRes.json()
      if (!srcRes.ok) throw new Error(src?.error || 'Could not read their course')
      if (!tgtRes.ok) throw new Error(tgt?.error || 'Could not read the standard course')
      if (diffForRef.current !== r.id) return
      const tgtSlugs = new Set((Array.isArray(tgt) ? tgt : []).map(s => s.slug))
      const srcList = Array.isArray(src) ? src : []
      setDiff({
        updates: srcList.filter(s => tgtSlugs.has(s.slug)).length,
        adds:    srcList.filter(s => !tgtSlugs.has(s.slug)).length,
      })
    } catch (e) {
      if (diffForRef.current !== r.id) return
      setDiff({ error: e.message })
    }
  }, [])

  const approve = useCallback(async (r) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${r.id}/approve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not apply the change')
      setApplied({
        name: r.target_name ?? 'the standard course',
        adds: diff?.adds ?? null,
        updates: diff?.updates ?? null,
      })
      setDecide(null)
      setDiff(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [busy, diff, load])

  const decline = useCallback(async (r) => {
    const text = note.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'changes_requested', review_note: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not send your note back')
      setDecide(null)
      setNote('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [busy, note, load])

  // Probe readability before jumping — the window can close between load and
  // click, and an unreadable slug would poison the course cache (S13 rule).
  const openTheirCourse = useCallback(async (r) => {
    try {
      const res = await otterFetch(`/api/software/${r.source_course_id}`)
      if (!res.ok) throw new Error()
    } catch {
      setError('Their course is not readable right now — the request may have just been decided. Refresh to see its current state.')
      return
    }
    onOpenCourse?.(r.source_course_id)
  }, [onOpenCourse])

  // The dialog is the proposer's actuator. False = the fork is not openable
  // (trashed); say so instead of a dead click.
  const openMyDialog = useCallback((r) => {
    const ok = onOpenDialog?.(r.source_course_id)
    if (!ok) {
      setError('Your copy of the course is not in your library — if it is in the trash, restore it first.')
    }
  }, [onOpenDialog])

  // Fallback for the edge where the fork is GONE (source_course_id nulled by
  // the purge's ON DELETE SET NULL): the dialog can't open, but the server
  // still lets the proposer settle their own request — accept a decline
  // ('rejected') or withdraw an open one ('withdrawn'). Without this, a
  // fork-less open request would sit in every reviewer's queue with no way
  // for anyone but a reviewer to end it.
  const settleWithoutFork = useCallback(async (r, status) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not record your answer')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [busy, load])

  // ── nomination actions (0064) ─────────────────────────────────────────────
  // Approving is a PROMOTION, not a status flip: otter_nomination_apply demotes
  // the incumbent standard for this slug and promotes this course in one
  // transaction. The server refuses a bare status change, because the pin
  // trigger would silently revert the visibility and record an approval that
  // never happened.
  const approveNom = useCallback(async (n) => {
    if (nomBusy) return
    setNomBusy(true); setNomError(null)
    try {
      const res = await otterFetch(`/api/otter/nominations/${n.id}/approve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not promote this course')
      setNomDecide(null)
      // superseded_course_id is written BY the RPC, so the row captured before
      // the click never has it — reading `n.superseded_name` made the "X stood
      // down" half of the banner unreachable. Take it from the settled row.
      const fresh = await loadNoms(true)
      const settled = fresh?.find(x => x.id === n.id)
      setPromoted({
        name: settled?.course_name ?? n.course_name ?? 'the course',
        superseded: settled?.superseded_name ?? null,
      })
      // Promotion changes the visibility of TWO courses. Without this the
      // library keeps rendering both at their old tier — the promoted course
      // still badged personal/shared, the demoted one still badged Company
      // standard — and ShareCourseDialog would compute selectableVisibilities
      // from the stale row.
      onCoursesChanged?.()
    } catch (e) {
      setNomError(e.message)
    } finally {
      setNomBusy(false)
    }
  }, [nomBusy, loadNoms, onCoursesChanged])

  const declineNom = useCallback(async (n) => {
    const text = nomNote.trim()
    if (!text || nomBusy) return
    setNomBusy(true); setNomError(null)
    try {
      const res = await otterFetch(`/api/otter/nominations/${n.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'changes_requested', review_note: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not send your note back')
      setNomDecide(null)
      setNomNote('')
      await loadNoms(true)
    } catch (e) {
      setNomError(e.message)
    } finally {
      setNomBusy(false)
    }
  }, [nomBusy, nomNote, loadNoms])

  // The consent window closes the instant the nomination is decided or
  // withdrawn, and `course_readable` is a snapshot from load time. Probe before
  // jumping: selectSoftware caches whatever it gets back WITHOUT an ok-check,
  // so an unreadable id poisons softwareCacheRef for the rest of the session.
  // This is the S13 rule its change-request sibling openTheirCourse follows.
  const openNominatedCourse = useCallback(async (n) => {
    try {
      const res = await otterFetch(`/api/software/${n.course_id}`)
      if (!res.ok) throw new Error()
    } catch {
      setNomError('Their course is not readable right now — the nomination may have just been decided. Refresh to see its current state.')
      return
    }
    onOpenCourse?.(n.course_id)
  }, [onOpenCourse])

  // Admins AND managers decide nominations — the one place the two roles are
  // equal, and the only difference from the change-request queue above.
  const isApprover = role === 'admin' || role === 'manager'
  const { nomToDecide, nomMine, nomDecided } = useMemo(() => {
    const d = [], m = [], h = []
    for (const n of noms) {
      const live = n.status === 'open' || n.status === 'changes_requested'
      // LIVENESS FIRST. Testing ownership first kept the caller's own settled
      // nominations in the live list forever, under a chip reading "Approved"
      // and copy offering to edit or withdraw them — actions
      // fn_otter_nomination_review refuses outright ("nomination already
      // approved — reopen is not permitted"), on a course whose submit panel
      // has since disappeared because it IS the standard now.
      if (!live) h.push(n)
      else if (n.proposed_by === userId) m.push(n)
      else if (isApprover) d.push(n)
    }
    return { nomToDecide: d, nomMine: m, nomDecided: h }
  }, [noms, userId, isApprover])

  const sectionHeader = (icon, text, count) => (
    <h3 className="otter-req-section-title">
      {icon}{text}{count != null ? <span className="otter-req-count">· {count}</span> : null}
    </h3>
  )

  const isManager = role === 'manager'

  // One row's head: what, who and when, and its status (the four lists).
  const rowHead = (title, meta, status, round) => (
    <>
      <span className="otter-req-text">
        <span className="otter-req-title">
          {title}
          {round > 1 && <span className="otter-req-round"> · round {round}</span>}
        </span>
        <span className="otter-req-meta">{meta}</span>
      </span>
      <StatusBadge status={status} />
    </>
  )

  return (
    <div className="otter-view wilson-dark-scroll">
      <div className="otter-view-page otter-req-page" data-width="reading">
        <SectionTitle
          rule={false}
          className="otter-view-title"
          description={isAdmin
            ? 'Courses put forward to become the company standard, and suggested changes to the standards you already have.'
            : isManager
              // A manager decides NOMINATIONS but not change requests (0064
              // widened one flow and deliberately not the other), so the
              // copy has to say which is which rather than "you can decide".
              ? 'Courses put forward to become the company standard — you decide those. Suggested changes to an existing standard are decided by an admin or the course’s owner.'
              : 'Courses you have put forward, changes you have suggested, and the feedback that came back.'}
          actions={<Button icon={RefreshCw} onClick={refreshAll} loading={loading}>Refresh</Button>}
        >
          {isAdmin || isManager ? 'Company library — requests' : 'My change requests'}
        </SectionTitle>

        {error && (
          <Banner tone="danger" icon={AlertCircle} className="otter-req-notice"
            action={<IconButton size="sm" icon={X} title="Dismiss" onClick={() => setError(null)} className="otter-notice-action" />}>
            {error}
          </Banner>
        )}

        {applied && !error && (
          <Banner tone="success" icon={Check} className="otter-req-notice"
            action={<IconButton size="sm" icon={X} title="Dismiss" onClick={() => setApplied(null)} className="otter-notice-action" />}>
            Applied to “{applied.name}”
            {applied.updates != null
              ? ` — ${applied.updates} subject${applied.updates === 1 ? '' : 's'} updated, ${applied.adds} added`
              : ''}.
            A pre-change archive was kept in your library.
          </Banner>
        )}

        {nomError && (
          <Banner tone="danger" icon={AlertCircle} className="otter-req-notice"
            action={<IconButton size="sm" icon={X} title="Dismiss" onClick={() => setNomError(null)} className="otter-notice-action" />}>
            {nomError}
          </Banner>
        )}

        {promoted && !nomError && (
          <Banner tone="success" icon={ShieldCheck} className="otter-req-notice"
            action={<IconButton size="sm" icon={X} title="Dismiss" onClick={() => setPromoted(null)} className="otter-notice-action" />}>
            “{promoted.name}” is now the company standard, live for everyone.
            {promoted.superseded
              ? ` “${promoted.superseded}” stood down and is now shared with the company — nothing was deleted.`
              : ''}
          </Banner>
        )}

        {loading && rows.length === 0 ? (
          <div className="otter-req-loading"><Loading label="Loading…" /></div>
        ) : (
          <>
            {/* ── For review (admins + standard-course owners) ── */}
            {(isAdmin || toReview.length > 0) && (
              <section className="otter-req-section">
                {sectionHeader(null, 'For your review', toReview.length)}
                {toReview.length === 0 ? (
                  <p className="otter-req-empty">
                    Nothing is waiting on you. When someone suggests a change to a company
                    standard course, it lands here.
                  </p>
                ) : (
                  <ul className="otter-req-list">
                    {toReview.map(r => {
                      const isOpen = expandedId === r.id
                      return (
                        <li key={r.id} className="otter-req">
                          <button
                            type="button"
                            onClick={() => { setExpandedId(prev => (prev === r.id ? null : r.id)); setDecide(null); setNote(''); setDiff(null) }}
                            aria-expanded={isOpen}
                            className="otter-req-head"
                          >
                            {rowHead(
                              r.target_name ?? 'A company standard course',
                              <>{r.proposer_label ?? 'someone'} · {fmt(r.created_at)}{(r.revision ?? 1) > 1 ? ` · round ${r.revision}` : ''}</>,
                              r.status,
                            )}
                          </button>

                          {isOpen && (
                            <div className="otter-req-body">
                              <p className="otter-req-label">What they changed, and why</p>
                              <p className="otter-req-summary">{r.summary}</p>

                              {r.source_readable ? (
                                <p className="otter-req-note">
                                  <Eye className="otter-req-note-icon" aria-hidden="true" />
                                  <span>
                                    Submitting shared their copy with reviewers while this request is open.{' '}
                                    <button type="button" onClick={() => openTheirCourse(r)} className="otter-req-link">
                                      Open their course <ExternalLink aria-hidden="true" />
                                    </button>
                                  </span>
                                </p>
                              ) : (
                                <p className="otter-req-note">
                                  <EyeOff className="otter-req-note-icon" aria-hidden="true" />
                                  <span>Their copy no longer exists, so the note above is all there is to go on.</span>
                                </p>
                              )}

                              {decide?.id === r.id && decide.action === 'approve' ? (
                                <div className="otter-req-confirm">
                                  <p className="otter-req-confirm-text">
                                    {diff?.loading ? (
                                      <span className="otter-req-comparing">
                                        <Spinner size="sm" aria-hidden="true" /> Comparing their course with the standard…
                                      </span>
                                    ) : diff?.error ? (
                                      <>Could not compare the two courses ({diff.error}) — approving will
                                      still update matching subjects and add new ones.</>
                                    ) : (
                                      <>Approving applies their course to
                                      “{r.target_name ?? 'the standard'}”: <strong>{diff?.updates ?? 0} subject{(diff?.updates ?? 0) === 1 ? '' : 's'} updated,
                                      {' '}{diff?.adds ?? 0} added</strong>.</>
                                    )}{' '}
                                    Nothing is deleted, and reference documents (hotkeys, functions,
                                    nodes) are untouched. A snapshot of the current standard is kept
                                    first, as a private archive owned by you.
                                  </p>
                                  <div className="otter-req-actions">
                                    <Button size="sm" onClick={() => { setDecide(null); setDiff(null) }} disabled={busy}>Cancel</Button>
                                    <Button variant="primary" size="sm" icon={Archive} onClick={() => approve(r)} disabled={diff?.loading} loading={busy}>
                                      Archive, then apply
                                    </Button>
                                  </div>
                                </div>
                              ) : decide?.id === r.id && decide.action === 'decline' ? (
                                <div className="otter-req-confirm">
                                  <p className="otter-req-confirm-text">
                                    Your note goes back to {r.proposer_label ?? 'the proposer'}. They can
                                    make the changes and resubmit, or accept the decision.
                                  </p>
                                  <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="What should change before you would approve this?"
                                    aria-label="Your note to the proposer"
                                    className="ui-input otter-req-textarea"
                                    data-surface="dark"
                                  />
                                  <div className="otter-req-actions">
                                    <Button size="sm" onClick={() => { setDecide(null); setNote('') }} disabled={busy}>Cancel</Button>
                                    <Button variant="primary" size="sm" onClick={() => decline(r)} disabled={!note.trim()} loading={busy}>
                                      Send it back
                                    </Button>
                                  </div>
                                  {!note.trim() && (
                                    <p className="otter-req-hint">
                                      A note is required — the proposer needs to know what to change.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="otter-req-actions">
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    icon={Check}
                                    onClick={() => { setDecide({ id: r.id, action: 'approve' }); setNote(''); loadDiff(r) }}
                                    disabled={!r.source_readable}
                                    title={r.source_readable ? undefined : 'Their course no longer exists — there is nothing to apply'}
                                  >
                                    Approve
                                  </Button>
                                  <Button size="sm" icon={X} onClick={() => { setDecide({ id: r.id, action: 'decline' }); setNote(''); setDiff(null) }}>
                                    Decline
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* ── Open requests (managers: view-only, 0026) ── */}
            {watching.length > 0 && (
              <section className="otter-req-section">
                {sectionHeader(null, 'Open requests', watching.length)}
                <ul className="otter-req-list">
                  {watching.map(r => {
                    const isOpen = expandedId === r.id
                    return (
                      <li key={r.id} className="otter-req">
                        <button
                          type="button"
                          onClick={() => setExpandedId(prev => (prev === r.id ? null : r.id))}
                          aria-expanded={isOpen}
                          className="otter-req-head"
                        >
                          {rowHead(
                            r.target_name ?? 'A company standard course',
                            <>{r.proposer_label ?? 'someone'} · {fmt(r.created_at)}{(r.revision ?? 1) > 1 ? ` · round ${r.revision}` : ''}</>,
                            r.status,
                          )}
                        </button>
                        {isOpen && (
                          <div className="otter-req-body">
                            <p className="otter-req-label">What they changed, and why</p>
                            <p className="otter-req-summary">{r.summary}</p>
                            <p className="otter-req-note">
                              <Lock className="otter-req-note-icon" aria-hidden="true" />
                              <span>An admin or the course&apos;s owner decides this one.</span>
                            </p>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* ── Company standard: courses put forward (0064) ──
                Admins AND managers decide here — the only surface where the
                two roles are equal. Approving PROMOTES the course and stands
                the incumbent down, so it confirms both halves before firing. */}
            {(isApprover || nomMine.length > 0 || nomDecided.length > 0) && (
              <section className="otter-req-section">
                {sectionHeader(
                  <ShieldCheck className="otter-req-section-icon" aria-hidden="true" />,
                  isApprover ? 'Put forward as company standard' : 'My nominations',
                  isApprover ? nomToDecide.length : nomMine.length)}

                {isApprover && nomToDecide.length === 0 && nomMine.length === 0 && (
                  <p className="otter-req-empty">
                    Nothing is waiting on you. When someone puts a course forward to become
                    the company standard, it lands here.
                  </p>
                )}

                <ul className="otter-req-list">
                  {[...nomToDecide, ...nomMine].map(n => {
                    const isOpen = expandedId === n.id
                    const isMine = n.proposed_by === userId
                    const canDecide = isApprover && !isMine && n.status === 'open'
                    return (
                      <li key={n.id} className="otter-req" data-attention={n.status === 'changes_requested' && isMine}>
                        <button
                          type="button"
                          onClick={() => { setExpandedId(prev => (prev === n.id ? null : n.id)); setNomDecide(null); setNomNote('') }}
                          aria-expanded={isOpen}
                          className="otter-req-head"
                        >
                          {rowHead(
                            n.course_name ?? 'A course',
                            <>{isMine ? 'put forward by you' : (n.proposer_label ?? 'someone')} · {fmt(n.created_at)}</>,
                            n.status,
                            n.revision ?? 1,
                          )}
                        </button>

                        {isOpen && (
                          <div className="otter-req-body">
                            <p className="otter-req-label">Why it should be the standard</p>
                            <p className="otter-req-summary">{n.summary}</p>

                            {isMine ? (
                              <p className="otter-req-note">
                                <Lock className="otter-req-note-icon" aria-hidden="true" />
                                <span>
                                  {n.status === 'changes_requested'
                                    ? `${n.reviewer_label ?? 'A reviewer'} asked for changes: “${n.review_note}” — respond from the course's “Share or submit…” menu.`
                                    : 'An admin or a manager decides this one. You can edit or withdraw it from the course’s “Share or submit…” menu.'
                                  }
                                  {/* Only live rows reach this branch — settled
                                      ones are bucketed into nomDecided, because
                                      neither sentence above is true of them. */}
                                </span>
                              </p>
                            ) : (
                              <>
                                {n.course_readable ? (
                                  <p className="otter-req-note">
                                    <Eye className="otter-req-note-icon" aria-hidden="true" />
                                    <span>
                                      Putting it forward opened their course to reviewers while this is
                                      undecided.{' '}
                                      <button type="button" onClick={() => openNominatedCourse(n)} className="otter-req-link">
                                        Open their course <ExternalLink aria-hidden="true" />
                                      </button>
                                    </span>
                                  </p>
                                ) : (
                                  <p className="otter-req-note">
                                    <EyeOff className="otter-req-note-icon" aria-hidden="true" />
                                    <span>Their course is not readable right now — refresh to see its current state.</span>
                                  </p>
                                )}

                                {canDecide && nomDecide?.id === n.id && nomDecide.action === 'approve' ? (
                                  <div className="otter-req-confirm">
                                    <p className="otter-req-confirm-text">
                                      This makes “{n.course_name}” the company standard, live for
                                      everyone immediately — anyone starting this topic will be
                                      offered it instead of generating their own. Any course
                                      currently holding that spot stands down to
                                      &ldquo;shared with the company&rdquo;; nothing is deleted.
                                    </p>
                                    <div className="otter-req-actions">
                                      <Button size="sm" onClick={() => setNomDecide(null)} disabled={nomBusy}>Cancel</Button>
                                      <Button variant="primary" size="sm" icon={ShieldCheck} onClick={() => approveNom(n)} loading={nomBusy}>
                                        Make it the standard
                                      </Button>
                                    </div>
                                  </div>
                                ) : canDecide && nomDecide?.id === n.id && nomDecide.action === 'decline' ? (
                                  <div className="otter-req-confirm">
                                    <p className="otter-req-confirm-text">
                                      Your note goes back to {n.proposer_label ?? 'the proposer'}. They can
                                      improve the course and resubmit, or accept the decision.
                                    </p>
                                    <textarea
                                      value={nomNote}
                                      onChange={(e) => setNomNote(e.target.value)}
                                      placeholder="What would have to change before this could be the company's official course?"
                                      aria-label="Your note to the proposer"
                                      className="ui-input otter-req-textarea"
                                      data-surface="dark"
                                    />
                                    <div className="otter-req-actions">
                                      <Button size="sm" onClick={() => { setNomDecide(null); setNomNote('') }} disabled={nomBusy}>Cancel</Button>
                                      <Button variant="primary" size="sm" onClick={() => declineNom(n)} disabled={!nomNote.trim()} loading={nomBusy}>
                                        Send it back
                                      </Button>
                                    </div>
                                    {!nomNote.trim() && (
                                      <p className="otter-req-hint">
                                        A note is required — the proposer needs to know what to change.
                                      </p>
                                    )}
                                  </div>
                                ) : canDecide ? (
                                  <div className="otter-req-actions">
                                    <Button variant="primary" size="sm" icon={Check} onClick={() => { setNomDecide({ id: n.id, action: 'approve' }); setNomNote('') }}>
                                      Approve
                                    </Button>
                                    <Button size="sm" icon={X} onClick={() => { setNomDecide({ id: n.id, action: 'decline' }); setNomNote('') }}>
                                      Decline
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="otter-req-note">
                                    <Lock className="otter-req-note-icon" aria-hidden="true" />
                                    <span>
                                      {n.status === 'changes_requested'
                                        ? 'Sent back to the proposer — waiting on them.'
                                        : 'An admin or a manager decides this one.'}
                                    </span>
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>

                {nomDecided.length > 0 && (
                  <ul className="otter-req-list otter-req-settled">
                    {nomDecided.map(n => (
                      <li key={n.id} className="otter-req otter-req-line" data-settled="true">
                        <span className="otter-req-text">
                          <span className="otter-req-title">
                            {n.course_name ?? 'A course'}
                            <span className="otter-req-round"> · {n.proposer_label ?? 'someone'}</span>
                          </span>
                          <span className="otter-req-meta">
                            {fmt(n.reviewed_at ?? n.updated_at)}
                            {n.status === 'approved' && n.superseded_name
                              ? ` — replaced “${n.superseded_name}”`
                              : n.review_note ? ` — “${n.review_note}”` : ''}
                          </span>
                        </span>
                        <StatusBadge status={n.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* ── My requests ── */}
            <section className="otter-req-section">
              {sectionHeader(null, 'My requests', mine.length)}
              {mine.length === 0 ? (
                <p className="otter-req-empty">
                  You haven&apos;t suggested any changes yet. Fork a company standard course,
                  make it better, then use “Suggest a change” from the course row.
                </p>
              ) : (
                <ul className="otter-req-list">
                  {mine.map(r => {
                    const needsMe = r.status === 'changes_requested'
                    return (
                      <li key={r.id} className="otter-req" data-attention={needsMe}>
                        <div className="otter-req-head" data-static="true">
                          {rowHead(r.target_name ?? 'A company standard course', <>sent {fmt(r.created_at)}</>, r.status, r.revision ?? 1)}
                        </div>
                        <div className="otter-req-body" data-flush="true">
                          <p className="otter-req-summary">{r.summary}</p>

                          {needsMe && (
                            <div className="otter-req-feedback">
                              <p className="otter-req-feedback-label">
                                <MessageSquareWarning aria-hidden="true" />
                                {r.reviewer_label ?? 'An admin'} asked for changes
                              </p>
                              <p className="otter-req-feedback-text">“{r.review_note}”</p>
                            </div>
                          )}

                          {!needsMe && r.status !== 'open' && (
                            <p className="otter-req-note">
                              <Lock className="otter-req-note-icon" aria-hidden="true" />
                              <span>
                                {r.status === 'withdrawn' ? (
                                  // A withdrawal is the PROPOSER's act — the server pins the
                                  // reviewer stamps to NULL, so there is no reviewer to name.
                                  <>Withdrawn by you on {fmt(r.updated_at)}</>
                                ) : (
                                  <>
                                    {statusMeta(r.status).label} by {r.reviewer_label ?? 'an admin'} on {fmt(r.reviewed_at)}
                                    {r.review_note ? ` — “${r.review_note}”` : ''}
                                    {r.status === 'approved' && r.applied_at ? ' · your changes are in the standard' : ''}
                                  </>
                                )}
                              </span>
                            </p>
                          )}

                          {(needsMe || r.status === 'open') && (
                            <div className="otter-req-actions">
                              {r.source_course_id ? (
                                <Button variant={needsMe ? 'primary' : 'secondary'} size="sm" icon={GitPullRequestArrow} onClick={() => openMyDialog(r)}>
                                  {needsMe ? 'Review & respond' : 'Open my request'}
                                </Button>
                              ) : needsMe ? (
                                <Button
                                  size="sm"
                                  icon={Check}
                                  onClick={() => settleWithoutFork(r, 'rejected')}
                                  loading={busy}
                                  title="Your copy of the course no longer exists, so resubmitting is not possible"
                                >
                                  Accept the decision
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  icon={X}
                                  onClick={() => settleWithoutFork(r, 'withdrawn')}
                                  loading={busy}
                                  title="Your copy of the course no longer exists, so editing or resubmitting is not possible"
                                >
                                  Withdraw request
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Decided history (reviewers) ── */}
            {decided.length > 0 && (
              <section className="otter-req-section">
                <Button variant="ghost" size="sm" onClick={() => setShowDecided(v => !v)} aria-expanded={showDecided} className="otter-req-decided">
                  Decided · {decided.length}
                  <ChevronRight className="otter-req-chevron" data-open={showDecided} aria-hidden="true" />
                </Button>
                {showDecided && (
                  <ul className="otter-req-list otter-req-settled">
                    {decided.map(r => (
                      <li key={r.id} className="otter-req otter-req-line" data-settled="true">
                        <span className="otter-req-text">
                          <span className="otter-req-title">
                            {r.target_name ?? 'A company standard course'}
                            <span className="otter-req-round"> · {r.proposer_label ?? 'someone'}</span>
                          </span>
                          <span className="otter-req-meta">
                            {fmt(r.reviewed_at ?? r.updated_at)}
                            {r.review_note ? ` — “${r.review_note}”` : ''}
                          </span>
                        </span>
                        <StatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
