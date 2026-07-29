// =============================================================================
// ChangeRequestsSection — the REVIEW half of O.T.T.E.R. change requests
// (Session 11).
//
// WHY IT LIVES HERE AND NOT IN O.T.T.E.R. (Audrey, 2026-07-29): reviewing is
// admin work, it belongs where admin work already lives, and putting it here
// leaves O.T.T.E.R.'s two-sidebar layout completely untouched. Only the SUBMIT
// side is in O.T.T.E.R., as a dialog off a course row.
//
// WHAT A REVIEWER CAN ACTUALLY SEE — stated plainly in the UI rather than
// papered over. A proposer's forked course is born PERSONAL and owned by them
// (otter_fork_course hardcodes it), so an admin cannot read it. 0022 calls the
// written summary "the review surface" and means it literally. When the
// proposer has also shared their copy, `source_readable` is true and the course
// name is shown so it can be opened in O.T.T.E.R.; otherwise the section says
// so instead of rendering an empty field.
//
// SETTLED IS FINAL. fn_otter_cr_review RAISES on any attempt to change the
// status of an already-decided request, so approve/reject is one-way. The UI
// confirms before deciding for exactly that reason, and surfaces the trigger's
// message verbatim if a race gets there first — it is already written for a
// person.
//
// UX laws embodied:
//   Jakob's Law        Same chip-tab + light-table grammar as Logs and Users.
//   Cognitive Bias     A one-way decision confirms. Nothing here fires on a
//                      single click.
//   Zeigarnik Effect   Open requests are the default tab and carry a count, so
//                      an unanswered proposal stays visible.
//   Von Restorff       Exactly one primary (Approve); Reject is quiet.
//   Working Memory     The rationale, the proposer, the target and the
//                      readability of the source all sit in one expanded row —
//                      no hopping to decide.
//   Postel's Law       A refusal from RLS or the trigger is shown as written,
//                      never swallowed into a fake success.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw, Loader2, GitPullRequestArrow, Check, X, AlertCircle, Lock, Eye, EyeOff,
} from 'lucide-react'
import { otterFetch } from '../../tools/otter_v0.3.1/adapters'

const TABS = [
  { key: 'open',    label: 'Open' },
  { key: 'settled', label: 'Decided' },
]

const STATUS_STYLE = {
  open:      { color: '#b45309', label: 'Open' },
  approved:  { color: '#166534', label: 'Approved' },
  rejected:  { color: '#991b1b', label: 'Rejected' },
  withdrawn: { color: '#57534e', label: 'Withdrawn' },
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
  const [decide, setDecide]   = useState(null)   // { id, status }
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)
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

  const submitDecision = useCallback(async () => {
    if (!decide || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await otterFetch(`/api/otter/change-requests/${decide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: decide.status,
          ...(note.trim() ? { review_note: note.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not record your decision')
      setDecide(null)
      setNote('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [decide, busy, note, load])

  const open = rows.filter(r => r.status === 'open')
  const settled = rows.filter(r => r.status !== 'open')
  const visible = tab === 'open' ? open : settled

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1 rounded-sm p-0.5" style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
              style={tab === t.key
                ? { backgroundColor: '#1c1917', color: '#f4a261' }
                : { backgroundColor: 'transparent', color: '#57534e' }}
            >
              {t.label}
              {t.key === 'open' && open.length > 0 && (
                <span className="ml-1.5" style={{ color: tab === t.key ? '#f4a261' : '#b45309' }}>
                  {open.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(153,27,27,0.10)' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#991b1b' }} />
          <span className="text-[11px] font-mono" style={{ color: '#991b1b' }}>{error}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto wilson-light-scroll">
        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#78716c' }} />
            <span className="text-[11px] font-mono" style={{ color: '#78716c' }}>Loading…</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <GitPullRequestArrow className="w-7 h-7" style={{ color: '#a8a29e' }} />
            <span className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>
              {tab === 'open'
                ? 'No one has suggested a change to a company standard course.'
                : 'Nothing has been decided yet.'}
            </span>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(r => {
              const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.open
              const isOpen = expandedId === r.id
              return (
                <li key={r.id} className="rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.08)' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(prev => (prev === r.id ? null : r.id))}
                    className="w-full text-left px-3 py-2 flex items-start gap-2"
                  >
                    <span
                      className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: st.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-bold" style={{ color: '#1c1917' }}>
                        {r.target_name ?? 'A company standard course'}
                      </span>
                      <span className="block text-[11px] font-mono truncate" style={{ color: '#57534e' }}>
                        {r.proposer_label ?? 'someone'} · {fmt(r.created_at)}
                      </span>
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
                      style={{ color: st.color }}
                    >
                      {st.label}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid rgba(120,70,30,0.15)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>
                        What they changed, and why
                      </p>
                      <p className="text-[12px] whitespace-pre-wrap mb-3" style={{ color: '#1c1917' }}>
                        {r.summary}
                      </p>

                      {/* The honest statement of what a reviewer can and cannot open. */}
                      <p className="text-[11px] font-mono mb-3 flex items-start gap-1.5" style={{ color: '#57534e' }}>
                        {r.source_readable ? (
                          <>
                            <Eye className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              They shared their copy — open “{r.source_name}” in O.T.T.E.R. to see the
                              changes themselves.
                            </span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              Their copy is private, so the note above is all there is to go on.
                              They can share it from the course&apos;s Sharing menu if you need to see it.
                            </span>
                          </>
                        )}
                      </p>

                      {r.status !== 'open' ? (
                        <p className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: '#57534e' }}>
                          <Lock className="w-3 h-3 flex-shrink-0" />
                          {st.label} by {r.reviewer_label ?? 'an admin'} on {fmt(r.reviewed_at)}
                          {r.review_note ? ` — “${r.review_note}”` : ''}
                        </p>
                      ) : decide?.id === r.id ? (
                        <div className="rounded-sm p-2" style={{ backgroundColor: 'rgba(120,70,30,0.12)' }}>
                          <p className="text-[11px] mb-2" style={{ color: '#1c1917' }}>
                            {decide.status === 'approved'
                              ? 'Approve this suggestion?'
                              : 'Reject this suggestion?'}{' '}
                            <strong>This is final</strong> — a decided request cannot be reopened.
                            {decide.status === 'approved' && (
                              <> Approving records your decision; it does not copy their changes into
                              the standard course, so make those edits yourself.</>
                            )}
                          </p>
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional note back to them…"
                            className="w-full h-16 px-2 py-1.5 text-[11px] font-mono rounded-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                            style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }}
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => { setDecide(null); setNote('') }}
                              disabled={busy}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50"
                              style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)', color: '#1c1917' }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={submitDecision}
                              disabled={busy}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50"
                              style={{
                                backgroundColor: decide.status === 'approved' ? '#166534' : '#991b1b',
                                color: '#fff',
                              }}
                            >
                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Yes, {decide.status === 'approved' ? 'approve' : 'reject'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setDecide({ id: r.id, status: 'approved' }); setNote('') }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                            style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDecide({ id: r.id, status: 'rejected' }); setNote('') }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                            style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)', color: '#1c1917' }}
                          >
                            <X className="w-3 h-3" /> Reject
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
