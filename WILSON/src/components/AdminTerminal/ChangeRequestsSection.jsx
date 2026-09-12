// =============================================================================
// ChangeRequestsSection — the REVIEW half of O.T.T.E.R. change requests
// (Session 11; Session 13 makes deciding REAL).
//
// WHY IT LIVES HERE AND NOT IN O.T.T.E.R. (Audrey, 2026-07-29): reviewing is
// admin work, it belongs where admin work already lives, and putting it here
// leaves O.T.T.E.R.'s two-sidebar layout completely untouched. Only the SUBMIT
// side is in O.T.T.E.R., as a dialog off a course row.
//
// SESSION 13 (locked #22 + migration 0025) changed what the buttons DO:
//
//   * APPROVE APPLIES. otter_cr_apply archives the standard to a private copy
//     owned by the approver, then copies the proposer's subjects in
//     ADDITIVELY — update by slug, insert when absent, NEVER delete — and the
//     five reference documents (hotkeys/functions/nodes/urls/corrections) are
//     untouched (their merge semantics live in client JS; §6 #29). The confirm
//     panel states all of that, with real counts, before anything writes.
//   * DECLINE IS A CONVERSATION. It moves the request to changes_requested
//     with a REQUIRED note; the proposer then revises and resubmits (the
//     request comes back to the Open tab at revision + 1) or accepts the
//     decision. There is no bare "reject" button any more — a flat no is just
//     a decline whose note says so.
//   * THE REVIEW WINDOW IS OPEN. Submitting grants reviewers read access to
//     the proposer's course while the request is open or changes_requested
//     (a consented exception, 0025), so "Open their course" now works — it
//     jumps to O.T.T.E.R. with the course selected.
//
// UX laws embodied (Session 13 pass):
//   Cognitive Bias     Approving writes to the company's canonical course, so
//                      it confirms — and the confirm says exactly what will
//                      happen: N updated, M added, nothing deleted, reference
//                      documents untouched, an archive kept.
//   Mental Model       Pull-request vocabulary throughout: approve, request
//                      changes, resubmit, round N. No invented terms.
//   Working Memory     The summary, the proposer, the diff counts, the note
//                      field and both actions sit in one expanded row —
//                      nothing to remember across screens.
//   Von Restorff       Exactly one primary action (Approve); Decline is quiet.
//   Peak-End Rule      The end of an approval says what happened: "3 updated,
//                      1 added — archive kept in your library."
//   Zeigarnik Effect   Open requests are the default tab and carry a count; a
//                      resubmitted request re-enters it at "round 2".
//   Postel's Law       Every server refusal (trigger, RLS, apply RPC) is
//                      surfaced verbatim — they are written for people.
//   Doherty Threshold  The apply round-trip (archive + copy) shows a busy
//                      state on the button that fired it, never a dead click.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, GitPullRequestArrow, Check, X, AlertCircle, Lock, Eye, EyeOff,
  ExternalLink, Archive,
} from 'lucide-react'
import { otterFetch } from '../../tools/otter_v0.3.1/adapters'
// UI overhaul C3b — the tokens come from `@theme` through `src/ui/tokens`
// now, not from the light-page alias module. Track A owns this file's JSX;
// this edit is colours and the two private button copies, nothing else.
import {
  INK, INK_2, RULE, PAPER_RAISED, SIGNAL, SUCCESS, DANGER,
} from '../../ui/tokens'
import Button from '../../ui/Button'
import Chip from '../../ui/Chip'
import SectionTitle from '../../ui/SectionTitle'
import StatusDot from '../../ui/StatusDot'
import EmptyState from '../../ui/EmptyState'
import Loading from '../../ui/Loading'

const TABS = [
  { key: 'open',    label: 'Open' },
  { key: 'settled', label: 'Decided' },
]

// 🚨 TONES, NOT COLOURS. This was the fifth private `statusColor` map in the
// app and the plan is explicit that a status colour can never be written
// inline again — `StatusDot` decides it from one source. The sweep had also
// collapsed `open` and `changes_requested` onto the same value, so the two
// states an admin most needs to tell apart looked identical: one is waiting
// on them, the other is waiting on the proposer.
const STATUS_TONE = {
  open:              { tone: 'signal',  label: 'Open' },
  changes_requested: { tone: 'warning', label: 'Changes requested' },
  approved:          { tone: 'success', label: 'Approved' },
  rejected:          { tone: 'danger',  label: 'Rejected' },
  withdrawn:         { tone: 'neutral', label: 'Withdrawn' },
}

function fmt(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleString()
}

export default function ChangeRequestsSection({ isActive }) {
  const [tab, setTab]         = useState('open')
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [decide, setDecide]   = useState(null)   // { id, action: 'approve' | 'decline' }
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
  // { adds, updates, loading, error } for the request whose approve panel is open.
  const [diff, setDiff]       = useState(null)
  // Peak-End: what the last approval actually did.
  const [applied, setApplied] = useState(null)   // { name, adds, updates }
  const loadedRef = useRef(false)

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

  // Lazy-fetch on FIRST activation only — this page renders for every admin at
  // launch under the all-pages-mounted shell (the AdminTerminalBody pattern).
  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    load()
  }, [isActive, load])

  // The counts the approve confirm shows (Cognitive Bias: say exactly what
  // will change before it does). Matched the same way the apply RPC matches:
  // by slug — in both lists = update in place, only in the source = insert.
  // diffForRef guards the race where a slow response for a PREVIOUSLY opened
  // request lands after the admin switched to another one — stale counts on a
  // write-confirm are worse than no counts (found by the S13 review).
  const diffForRef = useRef(null)
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

  // The review window (0025) makes the proposer's course readable, so this can
  // be a real jump: App.jsx navigates to O.T.T.E.R., which selects the course.
  // Probe readability BEFORE jumping — the window can have closed between the
  // queue load and the click (someone else decided the request), and shipping
  // an unreadable slug into Otter's cache would poison it with error JSON.
  // The refusal surfaces HERE, where the click happened (the S11 banner rule).
  const openTheirCourse = useCallback(async (r) => {
    try {
      const res = await otterFetch(`/api/software/${r.source_course_id}`)
      if (!res.ok) throw new Error()
    } catch {
      setError('Their course is not readable right now — the request may have just been decided. Refresh to see its current state.')
      return
    }
    window.dispatchEvent(new CustomEvent('wilson:open-otter-course', {
      detail: { slug: r.source_course_id },
    }))
  }, [])

  // Open = needs an admin's decision. changes_requested sits under Decided —
  // the admin HAS decided this round; it is waiting on the proposer and comes
  // back to Open by itself when they resubmit (Selective Attention: the Open
  // tab is exactly the to-do list).
  const open = rows.filter(r => r.status === 'open')
  const settled = rows.filter(r => r.status !== 'open')
  const visible = tab === 'open' ? open : settled

  return (
    <div className="at-section">
      {/* AT-10: this section opened with no heading at all — the tab chips
          were the first thing on it, and nothing said what the page was
          showing. */}
      <SectionTitle description="Course changes proposed by your team, waiting on an admin's decision.">
        Change requests
      </SectionTitle>
      <div className="flex items-center gap-2 mb-4">
        <div className="at-filter-group">
          {TABS.map(t => (
            <Chip
              key={t.key}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
              count={t.key === 'open' && open.length > 0 ? open.length : null}
            >
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ui-btn" data-variant="secondary" data-size="sm" data-surface="dark"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-control" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 12%, transparent)' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: DANGER }} />
          <span className="text-[11px]" style={{ color: DANGER }}>{error}</span>
        </div>
      )}

      {/* Peak-End: the approval's ending says what it did, in numbers. */}
      {applied && !error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-control" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)' }}>
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: SUCCESS }} />
          <span className="text-[11px]" style={{ color: SUCCESS }}>
            Applied to “{applied.name}”
            {applied.updates != null ? ` — ${applied.updates} subject${applied.updates === 1 ? '' : 's'} updated, ${applied.adds} added` : ''}.
            A pre-change archive was kept in your O.T.T.E.R. library.
          </span>
          <button type="button" onClick={() => setApplied(null)} className="ml-auto flex-shrink-0" aria-label="Dismiss">
            <X className="w-3 h-3" style={{ color: SUCCESS }} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto wilson-dark-scroll">
        {loading && rows.length === 0 ? (
          /* One column, not three: the list below is a stack of full-width
             cards, and the skeleton's contract is that the real rows land
             where the ghosts were. */
          <Loading rows={4} columns={1} label="Loading change requests" />
        ) : visible.length === 0 ? (
          /* The kit's empty state, at its 24px icon and Body title, rather
             than a private one at 28px and 11px mono italic — every other
             section on this surface already uses it. */
          <EmptyState
            Icon={GitPullRequestArrow}
            title={tab === 'open' ? 'Nothing waiting on you' : 'Nothing decided yet'}
            body={tab === 'open'
              ? 'No one has suggested a change to a company standard course.'
              : 'Decisions you make will be listed here.'}
          />
        ) : (
          <ul className="space-y-2">
            {visible.map(r => {
              const st = STATUS_TONE[r.status] ?? STATUS_TONE.open
              const isOpen = expandedId === r.id
              return (
                <li key={r.id} className="rounded-control" style={{ backgroundColor: PAPER_RAISED }}>
                  <button
                    type="button"
                    onClick={() => { setExpandedId(prev => (prev === r.id ? null : r.id)); setDecide(null); setNote(''); setDiff(null) }}
                    className="w-full text-left px-3 py-2 flex items-start gap-2"
                  >
                    <StatusDot tone={st.tone} label={st.label} className="at-cr-dot" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-bold" style={{ color: INK }}>
                        {r.target_name ?? 'A company standard course'}
                      </span>
                      <span className="block text-[11px] truncate" style={{ color: INK_2 }}>
                        {r.proposer_label ?? 'someone'} · {fmt(r.created_at)}
                        {(r.revision ?? 1) > 1 ? ` · round ${r.revision}` : ''}
                      </span>
                    </span>
                    <span
                      className="text-[11px] font-bold uppercase tracking-wider flex-shrink-0"
                      style={{ color: st.color }}
                    >
                      {st.label}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 pt-1" style={{ borderTop: `1px solid ${RULE}` }}>
                      <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: INK_2 }}>
                        What they changed, and why
                      </p>
                      <p className="text-[12px] whitespace-pre-wrap mb-3" style={{ color: INK }}>
                        {r.summary}
                      </p>

                      {/* The review window: readable while the request is live. */}
                      {(r.status === 'open' || r.status === 'changes_requested') && (
                        r.source_readable ? (
                          <p className="text-[11px] mb-3 flex items-start gap-1.5" style={{ color: INK_2 }}>
                            <Eye className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              Submitting shared their copy with reviewers for as long as this
                              request is open.{' '}
                              <button
                                type="button"
                                onClick={() => openTheirCourse(r)}
                                className="underline font-bold inline-flex items-center gap-0.5"
                                style={{ color: SIGNAL }}
                              >
                                Open their course <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] mb-3 flex items-start gap-1.5" style={{ color: INK_2 }}>
                            <EyeOff className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>Their copy no longer exists, so the note above is all there is to go on.</span>
                          </p>
                        )
                      )}

                      {r.status === 'changes_requested' ? (
                        <p className="text-[11px] flex items-center gap-1.5" style={{ color: INK_2 }}>
                          <Lock className="w-3 h-3 flex-shrink-0" />
                          Changes requested by {r.reviewer_label ?? 'an admin'} on {fmt(r.reviewed_at)}
                          {r.review_note ? ` — “${r.review_note}”` : ''}.
                          Waiting on {r.proposer_label ?? 'the proposer'} to revise or accept.
                        </p>
                      ) : r.status !== 'open' ? (
                        <p className="text-[11px] flex items-center gap-1.5" style={{ color: INK_2 }}>
                          <Lock className="w-3 h-3 flex-shrink-0" />
                          {st.label} by {r.reviewer_label ?? 'an admin'} on {fmt(r.reviewed_at)}
                          {r.review_note ? ` — “${r.review_note}”` : ''}
                          {r.status === 'approved' && r.applied_at
                            ? ' · applied, with a pre-change archive kept'
                            : ''}
                          {r.status === 'rejected' && r.acknowledged_at
                            ? ' · the proposer accepted the decision'
                            : ''}
                        </p>
                      ) : decide?.id === r.id && decide.action === 'approve' ? (
                        <div className="at-decide-panel">
                          {/* Cognitive Bias: this writes to the canonical course —
                              say exactly what will happen, then confirm. */}
                          <p className="text-[11px] mb-2" style={{ color: INK }}>
                            {diff?.loading ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin" /> Comparing their course with the standard…
                              </span>
                            ) : diff?.error ? (
                              <>Could not compare the two courses ({diff.error}) — approving will
                              still update matching subjects and add new ones.</>
                            ) : (
                              <>Approving applies their course to
                              “{r.target_name ?? 'the standard'}”: <strong>{diff?.updates ?? 0} subject{(diff?.updates ?? 0) === 1 ? '' : 's'} updated,
                              {' '}{diff?.adds ?? 0} added</strong>.</>
                            )}{' '}
                            Nothing is deleted, and reference documents (hotkeys, functions, nodes)
                            are untouched. A snapshot of the current standard is kept first, as a
                            private archive owned by you.
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              onClick={() => { setDecide(null); setDiff(null) }}
                              disabled={busy}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              Icon={Archive}
                              onClick={() => approve(r)}
                              disabled={busy || diff?.loading}
                              loading={busy}
                              loadingLabel="Applying…"
                            >
                              Archive, then apply
                            </Button>
                          </div>
                        </div>
                      ) : decide?.id === r.id && decide.action === 'decline' ? (
                        <div className="at-decide-panel">
                          {/* Postel: a decline is a conversation — the note is the
                              whole point, so it is required, not optional. */}
                          <p className="text-[11px] mb-2" style={{ color: INK }}>
                            Your note goes back to {r.proposer_label ?? 'the proposer'}. They can
                            make the changes and resubmit, or accept the decision.
                          </p>
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What should change before you would approve this?"
                            className="ui-input at-note-field"
                          />
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              onClick={() => { setDecide(null); setNote('') }}
                              disabled={busy}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => decline(r)}
                              disabled={busy || !note.trim()}
                              loading={busy}
                              loadingLabel="Sending…"
                            >
                              Send it back
                            </Button>
                          </div>
                          {!note.trim() && (
                            <p className="text-[11px] mt-1" style={{ color: INK_2 }}>
                              A note is required — the proposer needs to know what to change.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setDecide({ id: r.id, action: 'approve' }); setNote(''); loadDiff(r) }}
                            disabled={!r.source_readable}
                            className="ui-btn" data-variant="secondary" data-size="sm" data-surface="dark"
                            title={r.source_readable ? undefined : 'Their course no longer exists — there is nothing to apply'}
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDecide({ id: r.id, action: 'decline' }); setNote(''); setDiff(null) }}
                            className="ui-btn" data-variant="secondary" data-size="sm" data-surface="dark"
                          >
                            <X className="w-3 h-3" /> Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
