// =============================================================================
// otterSharing.js — Session 11
//
// Pure vocabulary + predicates for O.T.T.E.R.'s three visibility tiers. Kept
// free of React so the filter rules — the part with real edge cases — can be
// unit-tested without rendering a 4,600-line component.
//
// B2 (2026-10-27): and for SUBJECT SHARES (migration 0100; the design is
// docs/design/OTTER_SUBJECT_SHARES_DESIGN.md §5), at the foot of the file —
// the progression key, the state words, the lists' groupings, the loops and
// every sentence the screens say, in one place.
//
// EVERY consumer reads these fields off the row the SERVER returned
// (otter_course_index via course.list, or the RETURNING row of an update).
// Never off what the client sent: fn_otter_pin_course_identity SILENTLY REVERTS
// a visibility change it does not allow, so an optimistic update would show a
// course as shared that is still personal. That is the single most important
// rule in this file.
// =============================================================================

/** Tier -> what the user actually needs to know about it, in their words. */
export const VISIBILITY_META = {
  personal: {
    key: 'personal',
    label: 'Just for me',
    short: 'Personal',
    blurb: 'Only you can open this. Not even an admin can read it.',
  },
  shared: {
    key: 'shared',
    label: 'Share with the company',
    short: 'Shared',
    blurb: 'Everyone at the company can read it. You choose who can edit.',
  },
  company_standard: {
    key: 'company_standard',
    label: 'Company standard',
    short: 'Standard',
    blurb: 'The official version of this topic. Offered instead of generating a new course.',
  },
}

export const VISIBILITY_ORDER = ['personal', 'shared', 'company_standard']

export function visibilityMeta(visibility) {
  return VISIBILITY_META[visibility] ?? VISIBILITY_META.personal
}

// ── Filter chips ─────────────────────────────────────────────────────────────
// Hick's/Miller's Law: five chips at most, and the admin-only one is the fifth.
// Serial Position Effect puts the two the user reaches for constantly — their
// own work, and what was shared with them — first and second.
const COURSE_FILTERS = [
  { key: 'all',      label: 'All',              hint: 'Everything you can open' },
  { key: 'mine',     label: 'Made for me',      hint: 'Courses you own' },
  { key: 'to_me',    label: 'Shared with me',   hint: "Colleagues' shared courses" },
  { key: 'by_me',    label: 'Shared by me',     hint: 'Your courses others can see' },
  { key: 'standard', label: 'Company standard', hint: 'The official versions' },
  { key: 'trash',    label: 'Recently deleted', hint: 'Restorable for 30 days' },
]

/** Admins additionally get a chip for the metadata-only rows they cannot open. */
const ADMIN_ONLY_FILTER = {
  key: 'unopenable',
  label: 'Others’ personal',
  hint: 'You can see these exist, not what is in them',
}

/**
 * Does a course row belong under the given chip?
 *
 * `is_own` / `can_read_content` come straight from otter_course_index(). In
 * LOCAL (signed-out Electron) mode the Express server sends neither, so both
 * are undefined — hence the explicit `=== false` / `!== false` comparisons
 * throughout. A missing flag must mean "yours and readable", which is exactly
 * what single-user local mode is.
 */
export function courseMatchesFilter(course, filter) {
  if (!course) return false
  const isOwn = course.is_own !== false
  const vis = course.visibility ?? 'personal'

  switch (filter) {
    case 'all':
      // "Everything you can open" — deliberately NOT everything that exists.
      // An admin's index includes metadata-only rows for colleagues' personal
      // courses; listing those by default would fill the sidebar with entries
      // that do nothing when clicked. They get their own chip instead.
      return course.can_read_content !== false
    case 'mine':
      return isOwn
    case 'to_me':
      // Someone else's, and actually openable. An admin's metadata-only view of
      // a colleague's PERSONAL course is not "shared with me" — nothing was
      // shared, and the row cannot be opened.
      return !isOwn && course.can_read_content !== false
    case 'by_me':
      return isOwn && vis !== 'personal'
    case 'standard':
      return vis === 'company_standard'
    case 'unopenable':
      return course.can_read_content === false
    case 'trash':
      // Trash is served by otter_trash_index(), not by this list at all.
      return false
    default:
      return true
  }
}

/** Chips a given caller should see. Empty chips are still shown — a filter that
 *  vanishes when it has no results is a filter the user cannot trust. */
export function filtersFor(role) {
  return role === 'admin' ? [...COURSE_FILTERS, ADMIN_ONLY_FILTER] : COURSE_FILTERS
}

// ── Capability helpers ───────────────────────────────────────────────────────

/**
 * May the caller edit this course's CONTENT (generate, add subjects, validate)?
 *
 * Local mode sends no can_write, so undefined must read as true — otherwise
 * signing out of the cloud would disable every button in a single-user install.
 */
export function canWriteCourse(course) {
  return !course || course.can_write !== false
}

/** May the caller open the content at all, or is this a metadata-only row? */
export function canReadCourse(course) {
  return !course || course.can_read_content !== false
}

/**
 * Which tiers may this caller SET on this course?
 *
 * Mirrors fn_otter_pin_course_identity, which is the thing that actually
 * decides — offering an option the trigger will silently revert is worse than
 * not offering it, because the UI would show the change as having worked.
 *
 *   * only the owner (or an admin) may change visibility at all;
 *   * entering OR LEAVING company_standard is admin-only.
 */
export function selectableVisibilities(course, role) {
  const isAdmin = role === 'admin'
  const isOwn = course?.is_own !== false
  if (!isOwn && !isAdmin) return []
  if (course?.visibility === 'company_standard' && !isAdmin) return []
  return isAdmin ? VISIBILITY_ORDER : ['personal', 'shared']
}

/**
 * May the caller manage editor grants on this course?
 *
 * 0022's otter_course_editors_insert deliberately refuses an ADMIN granting on
 * a PERSONAL course: otherwise index -> self-grant -> read would defeat the
 * no-admin-content-bypass rule in two steps. That restriction was a critical
 * review finding in Session 10 and must not be "fixed" here.
 */
export function canManageEditors(course, role) {
  if (!course) return false
  if (course.is_own !== false) return true
  return role === 'admin' && course.visibility !== 'personal'
}

/**
 * The fork offer: is there a company-standard course for the name the user is
 * typing? Otter.jsx has always matched courses by lowercased name, so this uses
 * the same key — a fork of a different topic would be worse than no offer.
 */
export function findStandardByName(courseList, name) {
  const wanted = (name ?? '').trim().toLowerCase()
  if (!wanted) return null
  return (courseList ?? []).find(
    c => c.visibility === 'company_standard' && (c.name ?? '').toLowerCase() === wanted,
  ) ?? null
}

/** Whole days until a trashed row is swept, floored at 0. */
export function daysUntilPurge(purgesAt, now = Date.now()) {
  if (!purgesAt) return null
  const ms = new Date(purgesAt).getTime() - now
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.ceil(ms / 86400000))
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBJECT SHARES (0100) — B2, night 3. Design §1, §3.6, §5.
//
// A receiver reads ONE subject of a colleague's course, live and read-only,
// inside a course of their own (the HOST). Every rule below reads the rows the
// INDEX returned (otter_subject_shares_index, through share.list): `state` is
// derived there (`gone` for a trashed source, a course that changed hands or a
// link that does not resolve), and what each side may learn is decided there.
// The client derives no state of its own, and keeps no linked BODY anywhere
// (design §5.4: the body is read by id on each use and handed to one reader).
// ═════════════════════════════════════════════════════════════════════════════

const LINK_PREFIX = 'link:'

/**
 * THE one definition of a linked subject's progression key (design §1.3,
 * §5.5). A linked subject's ticks sit on the receiver's progress row for the
 * HOST course under `link:<subject_id>`, never under its slug: the host can
 * hold an own subject of the same slug (0065's trap), and two courses can
 * hold subjects of one slug. Nothing on the wire carries the key, so B1's
 * adapter and this client cannot drift (round 1, finding 13).
 */
export function linkKey(subjectId) {
  return LINK_PREFIX + subjectId
}

/** True for a key linkKey() made. A slug never starts with `link:` (slugify
 *  keeps [a-z0-9-] only), so the two key spaces cannot meet. */
export function isLinkKey(key) {
  return typeof key === 'string' && key.length > LINK_PREFIX.length && key.startsWith(LINK_PREFIX)
}

/**
 * The ACTIVE subject's key — what the progress ticks, the sidebar highlight
 * and every cache key read. The slug for one of the host's own subjects;
 * linkKey(subject id) while a linked subject is open, so a linked `modifiers`
 * never lights up, ticks under, or caches as the host's own `modifiers`
 * (design §5.4, round 1, finding 19).
 */
export function activeSubjectKeyOf(activeLinked, activeSubjectSlug) {
  return activeLinked?.subjectId ? linkKey(activeLinked.subjectId) : (activeSubjectSlug ?? null)
}

/** A row that is still a live offer or link (pending or accepted, whatever
 *  its derived state): the rows Withdraw, Remove and the counts act on. */
export function isLiveShare(row) {
  return row?.status === 'pending' || row?.status === 'accepted'
}

/** One row's state in the owner's and the sharer's words (design §5.3). */
export function shareStateWords(row) {
  switch (row?.state) {
    case 'pending':  return 'waiting'
    case 'accepted': return 'accepted'
    case 'declined': return 'declined'
    // `ended_by` names the hand: the receiver removing it from their course
    // (S3) reads differently from the owner or a sharer withdrawing it.
    case 'revoked':  return row.ended_by && row.ended_by === row.shared_with ? 'they removed it' : 'withdrawn'
    case 'gone':     return 'no longer available'
    default:         return row?.state ?? ''
  }
}

const people = (n) => (n === 1 ? '1 person' : `${n} people`)
const subjectsWord = (n) => (n === 1 ? '1 subject' : `${n} subjects`)
const quoted = (title) => `«${title || 'this subject'}»`

/** "2 days ago", for the inbox's offer line. */
export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso ?? NaN).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  return new Date(t).toLocaleDateString()
}

// ── the wire ─────────────────────────────────────────────────────────────────

/** The one identifier a function raises instead of a sentence (every 0100
 *  function re-checks membership first). */
export const NOT_A_MEMBER_WORDS =
  'You are not an active member of this workspace any more, so subjects cannot be shared or accepted here.'

/**
 * A failed share call, in words. A 409 is the function's own sentence —
 * written for a person and passed through verbatim — except
 * `not_a_workspace_member`, an identifier the client words. 501 is the Local
 * Server's (or the dev fixtures') own sentence. Anything else — a 500 is an
 * expired session or a lost connection — is NOT a refusal and must never read
 * as one (B1's adapter keeps it a 500 for exactly this).
 */
export function shareFailureText(status, body) {
  const said = typeof body?.error === 'string' ? body.error.trim() : ''
  if (said === 'not_a_workspace_member') return NOT_A_MEMBER_WORDS
  if ((status === 409 || status === 501 || status === 400) && said) return said
  return `That did not reach the workspace${status ? ` (HTTP ${status})` : ''}. Check your connection, or sign in again, then try again.`
}

async function readBody(res) {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

/**
 * One share call. `otterFetch` resolves for EVERY status, so the body is read
 * BEFORE `ok` is consulted, defensively (a body read after a failure can
 * throw first and replace the function's sentence with a SyntaxError).
 * Resolves { ok, status, data, text }: `text` is the failure in words.
 */
export async function shareCall(fetchImpl, url, init) {
  let res
  try {
    res = await fetchImpl(url, init)
  } catch {
    return { ok: false, status: 0, data: null, text: shareFailureText(0, null) }
  }
  const data = await readBody(res)
  if (res.ok) return { ok: true, status: res.status, data, text: null }
  return { ok: false, status: res.status, data, text: shareFailureText(res.status, data) }
}

/**
 * The batch loops (design §5.3: Accept all, Decline all, Withdraw all; §5.9:
 * the reminder's Share): one call per row, IN ORDER, stopping at the FIRST
 * refusal with its sentence; the rows it did not reach stay as they were (a
 * loop is recoverable in place, which is why there is no atomic batch
 * function, §7). `skip(row)` rows are passed over without a call: Accept all
 * skips `gone` rows, because a trashed subject refuses every accept and must
 * not hold the rest of the batch hostage (N2b round 1, finding 4).
 * `act(row)` resolves { ok, text }.
 */
export async function runShareLoop(rows, act, { skip } = {}) {
  const done = []
  const skipped = []
  for (const row of rows ?? []) {
    if (skip?.(row)) { skipped.push(row); continue }
    const out = await act(row)
    if (!out?.ok) return { done, skipped, stoppedAt: row, text: out?.text ?? null }
    done.push(row)
  }
  return { done, skipped, stoppedAt: null, text: null }
}

// ── the receiver: "Shared with you" (design §5.3) ────────────────────────────

const byTitle = (a, b) => String(a?.subject_title ?? '').localeCompare(String(b?.subject_title ?? ''))

/**
 * The rows the receiver's inbox draws: every row shared with me that is still
 * pending (a `gone` one too: it carries Dismiss), and every accepted link whose
 * host course I trashed (`host_live` false: restore it, or Remove).
 */
export function inboxRows(shares, userId) {
  if (!userId) return []
  return (shares ?? []).filter((r) => r?.shared_with === userId
    && (r.status === 'pending' || (r.status === 'accepted' && r.host_live === false)))
}

/** The inbox as it draws: pending rows sharing a `batch_id` are ONE card, its
 *  rows in title order (a batch's rows share one created_at, §3.5); every
 *  other row is its own entry; the index's order (newest first) otherwise. */
export function inboxEntries(rows) {
  const out = []
  const batches = new Map()
  for (const r of rows ?? []) {
    if (r.batch_id && r.status === 'pending') {
      let card = batches.get(r.batch_id)
      if (!card) {
        card = { kind: 'batch', batchId: r.batch_id, rows: [] }
        batches.set(r.batch_id, card)
        out.push(card)
      }
      card.rows.push(r)
    } else {
      out.push({ kind: 'row', row: r })
    }
  }
  for (const card of batches.values()) card.rows.sort(byTitle)
  return out
}

/** The Requests tab's count: every inbox row is waiting on its receiver. */
export function shareInboxCount(shares, userId) {
  return inboxRows(shares, userId).length
}

/** The line under one offer: the owner and the course, or, for an onward
 *  offer, who passed whose subject on (the person who accepts knows both). */
export function offerLine(row, now = Date.now()) {
  const when = timeAgo(row?.created_at, now)
  const tail = [row?.course_name, when].filter(Boolean).join(' · ')
  if (row?.via_share_id) {
    return `${row.sharer_label ?? 'Someone'} passes you ${row.owner_label ?? 'a colleague'}'s ${quoted(row.subject_title)}${tail ? ` · ${tail}` : ''}`
  }
  return `from ${row?.owner_label ?? 'a colleague'}${tail ? ` · ${tail}` : ''}`
}

/** A batch card's head: "Audrey shared their course «Blender 5.0» with you: 7 subjects". */
export function batchCardTitle(rows) {
  const first = rows?.[0] ?? {}
  return `${first.owner_label ?? 'A colleague'} shared their course ${quoted(first.course_name)} with you: ${subjectsWord(rows?.length ?? 0)}`
}

/** "1 of 7 is no longer available", or null. */
export function batchGoneLine(rows) {
  const gone = (rows ?? []).filter((r) => r.state === 'gone').length
  if (!gone) return null
  return `${gone} of ${rows.length} ${gone === 1 ? 'is' : 'are'} no longer available`
}

/** The sentence after an accept (design §5.3). `hostName` is the receiver's
 *  own course: found by the owner's slug, or made for them at the accept. */
export function acceptedSentence(rows, hostName) {
  const first = rows?.[0] ?? {}
  const owner = first.owner_label ?? 'a colleague'
  const host = hostName || first.course_name || 'your'
  if ((rows?.length ?? 0) > 1) {
    return `${rows.length} subjects are now in your ${host} course, linked live from ${owner}.`
  }
  return `${quoted(first.subject_title)} is now in your ${host} course, linked live from ${owner}. It stays read-only; your progress is your own.`
}

// ── the owner and the sharer: "Shared by you" (design §5.3) ──────────────────

/** Every row of my subjects (`is_owner`: the owner sees every row of their
 *  subject, whoever made it, §1.4) and every row I made (`is_mine`: a middle
 *  person sees what they passed on). */
export function sentRows(shares) {
  return (shares ?? []).filter((r) => r?.is_owner === true || r?.is_mine === true)
}

/** "Shared by you" as it draws: a batch is ONE line with its rows folded under
 *  it; every other row its own; an entry with no live row is decided. */
export function sentEntries(rows) {
  const out = []
  const batches = new Map()
  for (const r of rows ?? []) {
    if (r.batch_id) {
      let line = batches.get(r.batch_id)
      if (!line) {
        line = { kind: 'batch', batchId: r.batch_id, rows: [] }
        batches.set(r.batch_id, line)
        out.push(line)
      }
      line.rows.push(r)
    } else {
      out.push({ kind: 'row', row: r })
    }
  }
  for (const line of batches.values()) line.rows.sort(byTitle)
  const live = (e) => (e.kind === 'batch' ? e.rows.some(isLiveShare) : isLiveShare(e.row))
  return { live: out.filter(live), decided: out.filter((e) => !live(e)) }
}

/** The chain line's *via*: the person an onward row was passed on by,
 *  resolved from THE SAME LIST (the owner holds every row of their subject,
 *  so the parent row is there) as the parent's receiver; the row's own
 *  sharer label only when the parent is not listed. */
export function viaLabel(row, rowsById) {
  if (!row?.via_share_id) return null
  return rowsById?.get(row.via_share_id)?.receiver_label ?? row.sharer_label ?? null
}

/** The person on a "Shared by you" line: the receiver, and, on a row someone
 *  ELSE made for the owner's subject, "via" whoever passed it on (§5.3). A
 *  middle person's own onward rows name no via: its parent is their own link,
 *  and "Ben via <me>" would say nothing (B2 review round 1, finding 3). */
export function sentPersonLine(row, rowsById) {
  const via = row?.is_mine === true ? null : viaLabel(row, rowsById)
  return `${row?.receiver_label ?? 'someone'}${via ? ` via ${via}` : ''}`
}

/** The live rows hanging DIRECTLY below a row (`mineOnly`: the ones I passed
 *  on). Everyone further down falls with them (§1.4); the sentence says so. */
export function liveChildren(row, shares, { mineOnly = false } = {}) {
  if (!row?.id) return []
  return (shares ?? []).filter((r) => r.via_share_id === row.id && isLiveShare(r) && (!mineOnly || r.is_mine === true))
}

/** "shared whole with Mara · 7 subjects · 5 accepted, 2 waiting". */
export function batchLine(rows) {
  const first = rows?.[0] ?? {}
  const order = ['accepted', 'waiting', 'declined', 'withdrawn', 'they removed it', 'no longer available']
  const counts = new Map()
  for (const r of rows ?? []) {
    const w = shareStateWords(r)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const states = order.filter((w) => counts.has(w)).map((w) => `${counts.get(w)} ${w}`).join(', ')
  return `shared whole with ${first.receiver_label ?? 'someone'} · ${subjectsWord(rows?.length ?? 0)}${states ? ` · ${states}` : ''}`
}

/** The Withdraw confirm (§5.3), the chain's sentence added when rows hang
 *  below. Withdraw all passes the batch's live rows: one person, many rows,
 *  and every row passed on below any of them. */
export function withdrawConfirmText(rowOrRows, shares) {
  const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).filter(Boolean)
  const below = rows.reduce((n, r) => n + liveChildren(r, shares).length, 0)
  const lead = `${rows[0]?.receiver_label ?? 'They'} will lose the link. Their own progress stays theirs.`
  return below ? `${lead} Removing it ends it for the ${people(below)} it was passed on to, and for anyone they passed it on to.` : lead
}

/** The receiver's Remove confirm (§5.4, S3), counting what THEY passed on. */
export function removeConfirmText(row, shares) {
  const below = liveChildren(row, shares, { mineOnly: true }).length
  const lead = 'It leaves your course. Your ticks are kept, and come back if it is shared with you again.'
  return below ? `${lead} Removing it ends it for the ${people(below)} you passed it on to, and for anyone they passed it on to.` : lead
}

/** The owner's line under one of their own subjects (§5.4): every live row
 *  in CHAIN order — each link, then the links passed on below it — an onward
 *  one as "Ben via Mara", a pending one "(waiting)":
 *  "Shared with Mara · Ben via Mara · Priya (waiting)". Null when nothing is live. */
export function ownerShareLine(shares, subjectId) {
  if (!subjectId) return null
  const all = shares ?? []
  const live = all.filter((r) => r.subject_id === subjectId && r.is_owner === true && isLiveShare(r) && r.state !== 'gone')
  if (!live.length) return null
  const byId = new Map(all.map((r) => [r.id, r]))
  const liveIds = new Set(live.map((r) => r.id))
  const byTime = (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  const ordered = []
  const seen = new Set()
  const walk = (r) => {
    if (seen.has(r.id)) return   // a belt: depths only fall up a chain, so no cycle is real
    seen.add(r.id)
    ordered.push(r)
    for (const c of live.filter((x) => x.via_share_id === r.id).sort(byTime)) walk(c)
  }
  for (const r of live.filter((x) => !x.via_share_id || !liveIds.has(x.via_share_id)).sort(byTime)) walk(r)
  const parts = ordered.map((r) => {
    const via = viaLabel(r, byId)
    return `${r.receiver_label ?? 'someone'}${via ? ` via ${via}` : ''}${r.status === 'pending' ? ' (waiting)' : ''}`
  })
  return `Shared with ${parts.join(' · ')}`
}

/** The subject delete confirm's added sentence (§5.4), or null. */
export function deleteShareSentence(shares, subjectId) {
  if (!subjectId) return null
  const who = new Set((shares ?? [])
    .filter((r) => r.subject_id === subjectId && r.is_owner === true && isLiveShare(r))
    .map((r) => r.shared_with))
  if (!who.size) return null
  return `Shared with ${people(who.size)}: the link stops for them while it is in the trash and ends when it is purged.`
}

// ── the linked subject inside the receiver's course (design §5.4) ───────────

/** The linked rows a host course draws after its own subjects: my accepted
 *  links whose host is this course and is live, in accept order. Only the
 *  receiver is handed `host_course_id`, so nobody else's row can match. A
 *  `gone` row stays (greyed, with Remove). */
export function linkedRowsForHost(shares, hostSlug) {
  if (!hostSlug) return []
  return (shares ?? [])
    .filter((r) => r?.status === 'accepted' && r.host_course_id === hostSlug && r.host_live === true)
    .sort((a, b) => String(a.responded_at ?? '').localeCompare(String(b.responded_at ?? '')))
}

/** A linked row that does not open: the index says `gone`, or a read by id
 *  answered 404 this session (any state on a 404 reads as gone). */
export function isClosedLink(row, closedIds) {
  return row?.state === 'gone' || !!closedIds?.has(row?.id)
}

/**
 * The links a 404 closed (id → the state the re-read gave), less those the
 * owner has since RESTORED: a row the index now gives as `accepted` that was
 * not `accepted` when it closed (gone → accepted is a restore within the
 * 30 days, and §1.1 says the link resumes with nothing to redo). A row that
 * 404'd while the index said `accepted` stays closed: nothing has changed.
 * Returns the same Map when nothing reopens (B2 review round 1, finding 2).
 */
export function reopenRestoredLinks(closed, rows) {
  if (!closed?.size) return closed
  let next = null
  for (const r of rows ?? []) {
    if (closed.has(r?.id) && r.state === 'accepted' && closed.get(r.id) !== 'accepted') {
      next = next ?? new Map(closed)
      next.delete(r.id)
    }
  }
  return next ?? closed
}

/** "Linked from Audrey's Blender 5.0 · read only" — the row hint, and with
 *  `study` the study view's line (an onward link names who passed it on). */
export function linkedFromLine(row, { study = false } = {}) {
  const from = `Linked from ${row?.owner_label ?? 'a colleague'}'s ${row?.course_name ?? 'course'}`
  const via = row?.via_share_id && row?.sharer_label ? ` via ${row.sharer_label}` : ''
  return study
    ? `${from}${via} · read only · you see their edits as they make them`
    : `${from}${via} · read only`
}

/** What a 404 on opening a linked subject means, from the index's state read
 *  AFTER the 404 (design §5.4; round 1, finding 20): `revoked` is the link
 *  ended; anything else — `gone`, or a state the functions could not have
 *  made — reads as gone (N2b round 2, finding 5). */
export function linkClosedWords(row, title) {
  const t = quoted(row?.subject_title || title)
  if (row?.state === 'revoked') return `${t} is no longer shared with you.`
  return `${t} is no longer available: the owner removed it. It comes back if they restore it.`
}

/** A 404 whose re-read of the list FAILED has no state to choose words by:
 *  say only that it could not be read (B2 review round 1, finding 7). */
export function linkUnreadWords(title) {
  return `${quoted(title)} could not be read just now. Try again in a moment.`
}

/** The links a receiver can read, as one comparable string. When it changes
 *  on a share-list read the pet's warm index names subjects it may no longer
 *  read (design §5.6), so the caller clears it. */
export function acceptedSignature(shares) {
  return (shares ?? [])
    .filter((r) => r?.status === 'accepted' && r.state === 'accepted' && r.host_live === true && r.host_course_id)
    .map((r) => `${r.id}:${r.subject_id}:${r.host_course_id}`)
    .sort()
    .join('|')
}

// ── the share dialog (design §5.2) ───────────────────────────────────────────

/** Each mode's one contract line, verbatim from the design. */
export function shareContractLine(mode, { courseName, subjectCount, ownerLabel, subjectTitle } = {}) {
  const course = quoted(courseName || 'course')
  if (mode === 'course') {
    return `They will read all ${subjectCount ?? 0} subjects inside their own ${course} course, live and read-only, once they accept them. Subjects you add later are not included: O.T.T.E.R. will ask you. Nothing else in your course is shared, and their progress is their own.`
  }
  if (mode === 'passOn') {
    const owner = ownerLabel || 'The owner'
    return `They will read ${owner}'s ${quoted(subjectTitle)} inside their own ${course} course, live and read-only, once they accept. If ${owner} withdraws it from you, they lose it too, and ${owner} sees every link.`
  }
  return `They will read this one subject inside their own ${course} course, live and read-only, once they accept. Nothing else in your course is shared, and their progress is their own.`
}

/** "Mara", "Mara and Ben", "Mara, Ben and Priya". */
export function namesList(names) {
  const n = (names ?? []).filter(Boolean)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/** The single-subject (and pass-on) success: "Shared with Mara. It is waiting for them to accept." */
export function sharedSentence(names) {
  return `Shared with ${namesList(names)}. It is waiting for them to accept.`
}

/** The whole-course success: "Shared your course with Mara: 7 subjects,
 *  waiting for them to accept", then each subject the function skipped. */
export function sharedCourseSentence(name, count, skippedTitles = []) {
  const skipped = (skippedTitles ?? []).map((t) => ` ${quoted(t)} was already shared with them.`).join('')
  return `Shared your course with ${name}: ${subjectsWord(count)}, waiting for them to accept.${skipped}`
}

/** The course mode's subtitle: "7 subjects, 2 of them outlines". */
export function courseCountLine(subjects) {
  const all = subjects ?? []
  const stubs = all.filter((s) => s?.is_stub).length
  return `${subjectsWord(all.length)}${stubs ? `, ${stubs} of them outline${stubs === 1 ? '' : 's'}` : ''}`
}

/**
 * Who the pass-on picker leaves out (design §5.2): the subject's owner, me,
 * and anyone MY OWN index rows show holding a live offer or link to this
 * subject — receivers and sharers of those rows. A middle person's index
 * holds only their own rows, so a colleague the owner shared with directly is
 * not excluded; the function refuses that one in words (N2b round 1, finding 2).
 */
export function passOnExcluded(shares, shareRow, userId) {
  const out = new Set([shareRow?.subject_owner_id, userId].filter(Boolean))
  for (const r of shares ?? []) {
    if (r.subject_id !== shareRow?.subject_id || !isLiveShare(r)) continue
    if (r.shared_with) out.add(r.shared_with)
    if (r.shared_by) out.add(r.shared_by)
  }
  return out
}

// ── the reminder (design §5.9) ───────────────────────────────────────────────

/** The slugs a run saved that the course did not hold before it. A re-import
 *  or a regenerated subject is not new (subject.save updates a slug it
 *  finds), and a declined or withdrawn subject must not come back as new. */
export function newSlugsOf(slugsBefore, slugsSaved) {
  if (!Array.isArray(slugsBefore)) return []
  const before = new Set(slugsBefore)
  return [...new Set(slugsSaved ?? [])].filter((s) => s && !before.has(s))
}

/** The people a course was shared WHOLE with: receivers of my batch rows on
 *  this course whose state is pending or accepted, one entry per person. */
export function batchReceivers(shares, courseId) {
  const who = new Map()
  for (const r of shares ?? []) {
    if (!r?.batch_id || r.course_id !== courseId || r.is_owner !== true) continue
    if (r.state !== 'pending' && r.state !== 'accepted') continue
    if (!who.has(r.shared_with)) who.set(r.shared_with, { userId: r.shared_with, label: r.receiver_label ?? 'someone' })
  }
  return [...who.values()]
}

/**
 * The reminder's offer after a run: the new slugs mapped to ids from the
 * subject.list read AFTER the saves (a run holds slugs, never ids), each to
 * be offered to the batch receivers not already holding a live row for it
 * (it cannot happen for a new subject; the index is the truth all the same).
 * Null when there is nothing to ask.
 */
export function planNewSubjectReminder({ shares, courseId, slugsBefore, slugsSaved, listAfter }) {
  if (!Array.isArray(slugsBefore)) return null   // a new course: no batch row can exist for it
  const fresh = newSlugsOf(slugsBefore, slugsSaved)
  if (!fresh.length) return null
  const receivers = batchReceivers(shares, courseId)
  if (!receivers.length) return null
  const bySlug = new Map((listAfter ?? []).map((s) => [s.slug, s]))
  const subjects = fresh.map((s) => bySlug.get(s)).filter((s) => s?.id)
    .map((s) => ({ id: s.id, slug: s.slug, title: s.title || s.slug }))
  if (!subjects.length) return null
  const held = new Set((shares ?? []).filter(isLiveShare).map((r) => `${r.subject_id}|${r.shared_with}`))
  const courseName = (shares ?? []).find((r) => r.batch_id && r.course_id === courseId)?.course_name ?? null
  return { courseId, courseName, people: receivers, subjects, held }
}

/** The reminder's (subject, person) calls, in order: every new subject for
 *  each ticked person, less the pairs already held. */
export function reminderPairs(plan, tickedUserIds) {
  const ticked = new Set(tickedUserIds ?? [])
  const pairs = []
  for (const s of plan?.subjects ?? []) {
    for (const p of plan?.people ?? []) {
      if (!ticked.has(p.userId) || plan.held?.has(`${s.id}|${p.userId}`)) continue
      pairs.push({ subject: s, person: p })
    }
  }
  return pairs
}

/** The reminder's two lines (design §5.9), verbatim. */
export function reminderTitle(count) {
  return count === 1 ? 'Share the new subject too?' : `Share the ${count} new subjects too?`
}
export function reminderLine(courseName, names) {
  return `You shared ${quoted(courseName || 'this course')} whole with ${namesList(names)}. New subjects are not shared with them unless you say so.`
}
