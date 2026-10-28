// =============================================================================
// ShareSubjectDialog — B2 (2026-10-27), docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §5.2.
//
// A live, read-only link to colleagues, which they accept first. One dialog,
// three modes:
//
//   * 'subject' — the owner shares ONE subject: from the course row menu
//     ("Share a subject…", with a picker of the course's subjects; a stub may
//     be shared, marked "outline only") or from the study view of their own
//     subject ("Share…", pre-filled).
//   * 'course'  — the owner shares the WHOLE course ("Share this course
//     with…"): share.createCourse once per person, each a batch of rows, one
//     per live subject; the function skips a subject already shared with that
//     person, and the success names what it skipped.
//   * 'passOn'  — a receiver who accepted passes the one subject on ("Pass
//     on…" in a linked subject's study view): share.create, exactly as the
//     owner's share. The FUNCTION decides from the caller's accepted row; the
//     route and this dialog do not.
//
// Several colleagues at once in every mode: one call per person, each
// reported (one row per person is the model either way). A refusal is the
// function's own sentence, in the Dialog's footer; a failure that is not a
// refusal (a 500: an expired session) says so and never reads as one.
//
// Why a new file: ShareCourseDialog is the course's TIER and its editors (who
// can see and edit the whole course); this is a per-person consent offer on
// rows of another table, with its own three modes. Folding it in would put
// two unrelated flows behind one title. Its classes are ShareCourseDialog's,
// so it adds no style of its own.
//
// Mounted lazily by Otter.jsx: useWorkspaceMembers fires the directory RPC.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { otterFetch } from '../adapters'
import { Dialog, Button, IconButton, Select, Field, TextArea, Banner } from '../../../ui'
import { useWorkspaceMembers } from '../../../components/TeamMembers/useWorkspaceMembers'
import {
  shareCall, shareContractLine, sharedSentence, sharedCourseSentence, courseCountLine, passOnExcluded,
} from './otterSharing.js'

const NOTE_MAX = 2000
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const labelOf = (m) => m?.display_name || m?.username || 'someone'
const sentence = (t) => (t && !/[.!?]$/.test(t) ? `${t}.` : t)

/**
 * @param {object}   props
 * @param {'subject'|'course'|'passOn'} props.mode
 * @param {object}   [props.course]   the course row (subject and course modes): `slug` is its id in cloud mode
 * @param {object}   [props.subject]  a subject to share, pre-filled (`id`, `title`): the study view's Share…
 * @param {object}   [props.share]    the caller's accepted index row (pass-on mode)
 * @param {object[]} [props.shares]   the caller's share index (pass-on's exclusions)
 * @param {Function} [props.onShared] re-reads the index; resolves its rows (or null)
 * @param {Function} [props.onDone]   every person shared with: the sentence for the library's banner
 */
export default function ShareSubjectDialog({
  mode = 'subject', course = null, subject = null, share = null, shares = [], userId = null,
  fetchImpl = otterFetch, onClose, onShared, onDone,
}) {
  const wm = useWorkspaceMembers()
  const [subjects, setSubjects] = useState(null)
  const [subjectId, setSubjectId] = useState(subject?.id ?? null)
  const [picked, setPicked] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [partial, setPartial] = useState(null)

  // The course's own subjects: the picker (subject mode, from the menu) and
  // the live count (course mode). One read; the wire carries each row's id.
  const needsList = mode === 'course' || (mode === 'subject' && !subject)
  useEffect(() => {
    if (!needsList || !course?.slug) return undefined
    let alive = true
    shareCall(fetchImpl, `/api/software/${course.slug}/subjects`).then((out) => {
      if (!alive) return
      if (out.ok && Array.isArray(out.data)) setSubjects(out.data)
      else { setSubjects([]); setError(out.text) }
    })
    return () => { alive = false }
  }, [needsList, course?.slug, fetchImpl])

  const members = wm.members || []
  // Who may be chosen. Subject and course modes: every active member but the
  // owner (the caller). Pass-on: also anyone the caller's OWN index rows show
  // holding a live offer or link to this subject; the function refuses the
  // rest in words (design §5.2; N2b round 1, finding 2).
  const excluded = useMemo(() => (mode === 'passOn'
    ? passOnExcluded(shares, share, userId)
    : new Set([course?.owner_id, userId].filter(Boolean))), [mode, shares, share, userId, course?.owner_id])
  const candidates = members.filter((m) => m.is_active && !excluded.has(m.user_id) && !picked.includes(m.user_id))

  const targetId = mode === 'passOn' ? share?.subject_id : (subject?.id ?? subjectId)
  const courseName = mode === 'passOn' ? share?.course_name : course?.name
  const contract = shareContractLine(mode, {
    courseName,
    subjectCount: subjects?.length ?? 0,
    ownerLabel: share?.owner_label,
    subjectTitle: share?.subject_title,
  })
  const title = mode === 'course' ? 'Share this course' : mode === 'passOn' ? 'Pass on a subject' : 'Share a subject'
  const subtitle = mode === 'course'
    ? `${course?.name ?? ''}${subjects ? ` · ${courseCountLine(subjects)}` : ''}`
    : mode === 'passOn'
      ? `${share?.owner_label ?? 'A colleague'}'s «${share?.subject_title ?? ''}»`
      : (subject?.title ?? course?.name ?? null)

  const canShare = picked.length > 0 && !busy && (mode === 'course' ? !!course?.slug : !!targetId)

  const submit = useCallback(async () => {
    if (!canShare) return
    setBusy(true)
    setError(null)
    setPartial(null)
    const message = note.trim() || null
    const results = []
    // One call per person, IN ORDER, each reported. A refusal for one person
    // does not stop the others: they are independent offers.
    for (const uid of picked) {
      const name = labelOf(members.find((m) => m.user_id === uid))
      const out = mode === 'course'
        ? await shareCall(fetchImpl, '/api/otter/subject-shares/course', {
          method: 'POST', headers: JSON_HEADERS,
          body: JSON.stringify({ course_id: course.slug, shared_with: uid, message }),
        })
        : await shareCall(fetchImpl, '/api/otter/subject-shares', {
          method: 'POST', headers: JSON_HEADERS,
          body: JSON.stringify({ subject_id: targetId, shared_with: uid, message }),
        })
      results.push({ uid, name, out })
    }
    const shared = results.filter((r) => r.out.ok)
    const refused = results.filter((r) => !r.out.ok)
    // The index again, after any success: the lists, the tab's count, and —
    // for a whole course — the count, which is the rows carrying the batch id
    // the function returned (it skips what is already shared with the person).
    const fresh = shared.length ? await onShared?.() : null
    let said = ''
    if (mode === 'course') {
      said = shared.map((r) => {
        const batchId = r.out.data?.batch_id
        const rows = Array.isArray(fresh) ? fresh.filter((x) => batchId && x.batch_id === batchId) : null
        const ids = new Set((rows ?? []).map((x) => x.subject_id))
        const skipped = rows ? (subjects ?? []).filter((s) => s.id && !ids.has(s.id)).map((s) => s.title || s.slug) : []
        return sharedCourseSentence(r.name, rows ? rows.length : (subjects?.length ?? 0), skipped)
      }).join(' ')
    } else if (shared.length) {
      said = sharedSentence(shared.map((r) => r.name))
    }
    if (!refused.length) {
      onDone?.(said)
      return
    }
    // Some were refused: keep exactly those picked, so Share again cannot
    // offer anyone twice; say who was shared with and why the rest were not.
    setPicked(refused.map((r) => r.uid))
    setPartial(said || null)
    setError(refused.map((r) => `${r.name}: ${sentence(r.out.text)}`).join(' '))
    setBusy(false)
  }, [canShare, note, picked, members, mode, course, targetId, fetchImpl, onShared, onDone, subjects])

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      width="form"
      busy={busy}
      error={error ?? wm.error ?? null}
      dismissOnBackdrop
      onClose={onClose}
      className="otter-share"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canShare} loading={busy}>Share</Button>
        </>
      )}
    >
      <div className="otter-share-body">
        {mode === 'subject' && !subject && (
          <Field label="Subject">
            <Select
              value={subjectId}
              onChange={setSubjectId}
              disabled={busy || !subjects}
              placeholder={!subjects ? 'Loading subjects…' : subjects.length ? 'Choose a subject…' : 'This course has no subjects yet'}
              options={(subjects ?? []).map((s) => ({
                value: s.id,
                label: s.is_stub ? `${s.title || s.slug} (outline only)` : (s.title || s.slug),
              }))}
              className="otter-share-pick"
            />
          </Field>
        )}

        <Field label="With">
          <Select
            value={null}
            onChange={(v) => { if (v) setPicked((p) => (p.includes(v) ? p : [...p, v])) }}
            disabled={busy || wm.loading}
            placeholder={wm.loading ? 'Loading colleagues…' : candidates.length ? 'Choose a colleague…' : 'Nobody else to choose'}
            options={candidates.map((m) => ({ value: m.user_id, label: labelOf(m) }))}
            className="otter-share-pick"
          />
        </Field>
        {picked.length > 0 && (
          <ul className="otter-share-editors" aria-label="Sharing with">
            {picked.map((uid) => {
              const name = labelOf(members.find((m) => m.user_id === uid))
              return (
                <li key={uid} className="otter-share-editor">
                  <span className="otter-share-editor-name">{name}</span>
                  <IconButton
                    size="sm"
                    icon={X}
                    title={`Remove ${name}`}
                    disabled={busy}
                    onClick={() => setPicked((p) => p.filter((x) => x !== uid))}
                  />
                </li>
              )
            })}
          </ul>
        )}

        <Field label="A note for them" hint={`${note.length} / ${NOTE_MAX}`}>
          <TextArea
            value={note}
            onChange={(v) => setNote((v ?? '').slice(0, NOTE_MAX))}
            maxLength={NOTE_MAX}
            disabled={busy}
            placeholder="Optional"
            className="otter-share-pitch"
          />
        </Field>

        <p className="otter-share-text">{contract}</p>

        {partial && <Banner tone="success" className="otter-share-done">{partial}</Banner>}
      </div>
    </Dialog>
  )
}
