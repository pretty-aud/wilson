// =============================================================================
// supabaseOtterAdapter.js — Session 10
//
// Implements O.T.T.E.R.'s local HTTP surface against the cloud tables from
// migration 0022. Every method returns EXACTLY the shape the Express server in
// electron/main.cjs returned, so Otter.jsx and Validator.jsx keep working
// unchanged behind otterFetch().
//
// Two translations are load-bearing:
//
//   * "slug" from the client's point of view is the course UUID. On disk a
//     course was identified by slugify(name), which is only unique within one
//     user's own folder — in a shared workspace two visible courses can carry
//     the same slug (your fork and the company standard, or two colleagues'
//     shared courses). Otter.jsx never interprets the slug: it looks courses up
//     by NAME (Otter.jsx:645, 1528, 3408) and only ever passes the slug back as
//     an opaque URL key. So handing it the UUID is transparent and removes the
//     ambiguity entirely. The real slug still lives on the row for the
//     migration tool's natural key.
//   * the wire field is `type`; the column is `course_type` (`type` is too
//     generic to sit unqualified in a schema).
//
// workspace_id and owner_id are deliberately omitted from inserts: the columns
// DEFAULT to current_workspace_id() / auth.uid(), so the database decides
// tenancy from the JWT and a client can never mis-stamp it.
// =============================================================================

import { supabase } from '../../../cloud/auth/supabaseClient.js'
import { COURSE_DOCS, DOC_MERGERS, CR_DOC_MERGE, migrateNodesData, slugify } from './otterRoutes.js'

/** Columns that make up a subject's list entry — deliberately excludes the
 *  fat `sections` blob so the sidebar never pulls whole courses. */
const SUBJECT_LIST_COLS =
  'id, slug, title, description, skill_level, is_stub, subject_order'
const SUBJECT_FULL_COLS =
  `${SUBJECT_LIST_COLS}, estimated_hours, sections, section_outlines, sources, prerequisites, created_at, updated_at`

/** The 0022 CHECK constraint, mirrored so a typo fails here rather than at the DB. */
const VISIBILITIES = new Set(['personal', 'shared', 'company_standard'])

/** One quiz attempt on the wire (migration 0045). */
const QUIZ_COLS = 'id, taken_at, score, total, courses, question_types'

class OtterCloudError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.status = status
  }
}

function unwrap({ data, error }, { status = 500 } = {}) {
  if (error) throw new OtterCloudError(error.message, error.code === 'PGRST116' ? 404 : status)
  return data
}

/** Wire shape for a course, matching the Express `_meta.json` response. */
function toCourseWire(row, extra = {}) {
  return {
    slug: row.id,
    name: row.name,
    type: row.course_type ?? row.type ?? 'software',
    skill_level: row.skill_level ?? 'beginner',
    created_at: row.created_at,
    // Cloud-only fields. The local server never sent these; Otter.jsx ignores
    // unknown keys, and the Session 10 UI reads them for the tier filters.
    visibility: row.visibility,
    owner_id: row.owner_id,
    owner_label: row.owner_label,
    is_own: row.is_own,
    can_write: row.can_write,
    can_read_content: row.can_read_content,
    source_course_id: row.source_course_id,
    ...extra,
  }
}

function toSubjectWire(row, courseId) {
  if (!row) return null
  return {
    slug: row.slug,
    software_slug: courseId,
    title: row.title,
    description: row.description ?? '',
    skill_level: row.skill_level ?? 'beginner',
    is_stub: row.is_stub ?? false,
    subject_order: row.subject_order ?? 0,
    estimated_hours: row.estimated_hours ?? undefined,
    sections: row.sections ?? [],
    section_outlines: row.section_outlines ?? [],
    sources: row.sources ?? [],
    prerequisites: row.prerequisites ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

/**
 * The caller's workspace, read from the TOKEN payload (the Session 9
 * Edge-Function rule: app_metadata on the user object is not authoritative).
 *
 * Needed because ONE table breaks the pattern every other O.T.T.E.R. table
 * follows. otter_courses, otter_subjects, otter_progress and
 * otter_change_requests all declare
 *   workspace_id UUID NOT NULL DEFAULT public.current_workspace_id()
 * so omitting it lets the database stamp tenancy from the JWT and a client
 * cannot get it wrong. `otter_course_editors` declares a bare
 * `workspace_id UUID NOT NULL` with NO default — it needs the column for its
 * composite FK to workspace_members, and 0022 never gave it one.
 * fn_otter_editor_grant_workspace is a VALIDATOR, not a defaulter: it compares
 * NEW.workspace_id against the course's and raises if they differ. A NULL is
 * "different", so an insert that omits the column fails every time with
 * `P0001 editor grant workspace does not match the course workspace` — verified
 * directly against Postgres 17 on wilson-dev.
 *
 * Every pgTAP fixture supplies the column explicitly, which is exactly why the
 * suites pass while the client path is dead.
 */
async function currentWorkspaceId() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.app_metadata?.workspace_id ?? null
  } catch {
    return null
  }
}

export const supabaseOtterAdapter = {
  mode: 'supabase',

  // ── courses ───────────────────────────────────────────────────────────────

  async 'course.list'() {
    // The RPC, not a table read: it also surfaces courses an admin may only
    // know the existence of, and carries subject_count + the capability flags.
    const rows = unwrap(await supabase.rpc('otter_course_index')) ?? []
    return rows.map(r => toCourseWire(r, { subject_count: r.subject_count ?? 0 }))
  },

  async 'course.get'({ slug }) {
    const row = unwrap(
      await supabase.from('otter_courses')
        .select('id, name, course_type, skill_level, visibility, owner_id, source_course_id, created_at')
        .eq('id', slug).maybeSingle())
    if (!row) throw new OtterCloudError('Not found', 404)
    return toCourseWire(row)
  },

  async 'course.create'({ body }) {
    const name = body?.name ?? ''
    const row = unwrap(
      await supabase.from('otter_courses')
        .insert({
          slug: slugify(name) || 'course',
          name,
          course_type: body?.type || 'software',
          skill_level: body?.skill_level || 'beginner',
          // Session 11: the tier picker sends what the user chose and the
          // DATABASE decides whether they may have it. otter_courses_insert
          // refuses company_standard to non-admins outright (an error, not a
          // silent downgrade), so the client must not pre-filter the value —
          // doing so would hide a real refusal behind a fake success. Anything
          // unrecognised still falls back to personal.
          visibility: VISIBILITIES.has(body?.visibility) ? body.visibility : 'personal',
        })
        .select('id, name, course_type, skill_level, visibility, owner_id, source_course_id, created_at')
        .single())
    return toCourseWire(row)
  },

  async 'course.update'({ slug, body }) {
    const patch = {}
    if (body?.name != null)        patch.name = body.name
    if (body?.type != null)        patch.course_type = body.type
    if (body?.skill_level != null) patch.skill_level = body.skill_level
    if (body?.visibility != null)  patch.visibility = body.visibility
    const row = unwrap(
      await supabase.from('otter_courses').update(patch).eq('id', slug)
        .select('id, name, course_type, skill_level, visibility, owner_id, source_course_id, created_at')
        .single())
    return toCourseWire(row)
  },

  // Soft delete: 30-day trash, never a hard DELETE from the UI.
  async 'course.delete'({ slug }) {
    unwrap(await supabase.rpc('otter_soft_delete_row', { p_table: 'otter_courses', p_id: slug }))
    return { ok: true }
  },

  // ── subjects ──────────────────────────────────────────────────────────────

  async 'subject.list'({ slug }) {
    // Ordered read only. The Express server recomputed subject_order with a
    // regex "curriculum score" and rewrote every subject file on EVERY list
    // call; as a cloud read that would be N UPDATEs per page load. Order is
    // now persisted and only changes on an explicit reorder/renumber.
    const rows = unwrap(
      await supabase.from('otter_subjects').select(SUBJECT_LIST_COLS)
        .eq('course_id', slug).order('subject_order', { ascending: true })) ?? []
    return rows.map(r => ({
      slug: r.slug,
      title: r.title || r.slug,
      description: r.description ?? '',
      skill_level: r.skill_level ?? 'beginner',
      is_stub: r.is_stub ?? false,
      subject_order: r.subject_order ?? 0,
    }))
  },

  async 'subject.get'({ slug, sub }) {
    const row = unwrap(
      await supabase.from('otter_subjects').select(SUBJECT_FULL_COLS)
        .eq('course_id', slug).eq('slug', sub).maybeSingle())
    if (!row) throw new OtterCloudError('Not found', 404)
    return toSubjectWire(row, slug)
  },

  async 'subject.save'({ slug, sub, body }) {
    const subjectSlug = sub || body?.slug || slugify(body?.title || '')
    if (!subjectSlug) throw new OtterCloudError('subject slug or title required', 400)

    let order = body?.subject_order
    if (order == null) {
      // Append: max+1, matching the Express auto-assign.
      const rows = unwrap(
        await supabase.from('otter_subjects').select('subject_order')
          .eq('course_id', slug).order('subject_order', { ascending: false }).limit(1)) ?? []
      order = (rows[0]?.subject_order ?? 0) + 1
    }

    const payload = {
      title: body?.title || subjectSlug,
      description: body?.description ?? '',
      skill_level: body?.skill_level || 'beginner',
      is_stub: body?.is_stub ?? false,
      subject_order: order,
      estimated_hours: body?.estimated_hours ?? null,
      sections: body?.sections ?? [],
      section_outlines: body?.section_outlines ?? [],
      sources: body?.sources ?? [],
      prerequisites: body?.prerequisites ?? [],
    }

    // Deliberately NOT .upsert(). The uniqueness of (course_id, slug) is a
    // PARTIAL index (WHERE deleted_at IS NULL) so a trashed subject never
    // blocks recreating one. supabase-js emits a bare
    // `ON CONFLICT (course_id, slug)`, which Postgres cannot match to a partial
    // index — it raises 42P10, and because no O.T.T.E.R. call site checks
    // res.ok the UI would have reported every generated subject as saved while
    // nothing at all was written. Verified against Postgres 17 on wilson-dev.
    const existing = unwrap(
      await supabase.from('otter_subjects').select('id')
        .eq('course_id', slug).eq('slug', subjectSlug).maybeSingle())

    let row
    if (existing) {
      row = unwrap(
        await supabase.from('otter_subjects').update(payload)
          .eq('id', existing.id).select(SUBJECT_FULL_COLS).maybeSingle())
      // 0 rows means RLS refused the write, not that the row vanished.
      if (!row) throw new OtterCloudError('not allowed to edit this subject', 403)
    } else {
      row = unwrap(
        await supabase.from('otter_subjects')
          .insert({ course_id: slug, slug: subjectSlug, ...payload })
          .select(SUBJECT_FULL_COLS).single())
    }
    return toSubjectWire(row, slug)
  },

  async 'subject.delete'({ slug, sub }) {
    const row = unwrap(
      await supabase.from('otter_subjects').select('id')
        .eq('course_id', slug).eq('slug', sub).maybeSingle())
    if (row) {
      unwrap(await supabase.rpc('otter_soft_delete_row', { p_table: 'otter_subjects', p_id: row.id }))
    }
    return { ok: true, subjects: await supabaseOtterAdapter['subject.list']({ slug }) }
  },

  // Non-destructive: the client-side curriculum heuristic decides an order and
  // POSTs it to subject.reorder. Renumber alone just re-reads.
  async 'subject.renumber'({ slug }) {
    return supabaseOtterAdapter['subject.list']({ slug })
  },

  async 'subject.reorder'({ slug, body }) {
    const ordered = Array.isArray(body?.orderedSlugs) ? body.orderedSlugs : null
    if (!ordered) throw new OtterCloudError('orderedSlugs array required', 400)
    let i = 1
    for (const s of ordered) {
      unwrap(await supabase.from('otter_subjects').update({ subject_order: i })
        .eq('course_id', slug).eq('slug', s))
      i += 1
    }
    // Anything not named keeps a stable tail position.
    const rest = unwrap(
      await supabase.from('otter_subjects').select('slug')
        .eq('course_id', slug).not('slug', 'in', `(${ordered.map(s => `"${s}"`).join(',') || '""'})`)) ?? []
    for (const r of rest) {
      unwrap(await supabase.from('otter_subjects').update({ subject_order: i })
        .eq('course_id', slug).eq('slug', r.slug))
      i += 1
    }
    return supabaseOtterAdapter['subject.list']({ slug })
  },

  // ── per-course documents (hotkeys / functions / nodes / refs / corrections) ─

  async 'doc.get'({ slug, doc }) {
    const { column, empty } = COURSE_DOCS[doc]
    const row = unwrap(
      await supabase.from('otter_courses').select(column).eq('id', slug).maybeSingle())
    const value = row?.[column] ?? empty
    return doc === 'nodes' ? migrateNodesData(value) : value
  },

  // `.select('id').maybeSingle()` on every write is load-bearing: an UPDATE
  // that RLS refuses affects 0 rows and PostgREST returns 204 with NO error, so
  // a bare update reports success. A member without an edit grant would see
  // their generated content in the UI for the rest of the session and lose it
  // on reload.
  async 'doc.put'({ slug, doc, body }) {
    const { column, empty } = COURSE_DOCS[doc]
    const row = unwrap(await supabase.from('otter_courses')
      .update({ [column]: body ?? empty }).eq('id', slug).select('id').maybeSingle())
    if (!row) throw new OtterCloudError('not allowed to edit this course', 403)
    return { ok: true }
  },

  async 'doc.merge'({ slug, doc, body }) {
    const { column, empty } = COURSE_DOCS[doc]
    const merger = DOC_MERGERS[doc]
    if (!merger) throw new OtterCloudError(`${doc} does not support merge`, 400)
    // Read-modify-write. Courses are single-author surfaces (owner + admins +
    // named editors), so a lost-update race needs two people generating into
    // the same course at the same second; the local server had exactly the
    // same semantics. If that ever matters, move the merge into an RPC.
    const current = unwrap(
      await supabase.from('otter_courses').select(column).eq('id', slug).maybeSingle())
    const incoming = doc === 'corrections' ? (body?.corrections ?? []) : (body?.categories ?? [])
    const merged = merger(current?.[column] ?? empty, incoming)
    const row = unwrap(await supabase.from('otter_courses')
      .update({ [column]: merged }).eq('id', slug).select('id').maybeSingle())
    if (!row) throw new OtterCloudError('not allowed to edit this course', 403)
    return merged
  },

  // ── per-user progress + quiz history ──────────────────────────────────────

  // WIRE SHAPE — read this before touching either half.
  // Otter.jsx does NOT use a flat completed_lessons list. It keeps
  //   { completed_lessons: [], last_accessed: null,
  //     subjects: { '<subject-slug>': { completed_lessons: [...], last_accessed } } }
  // writing the whole object (Otter.jsx:2123-2138) and reading it back at
  // Otter.jsx:2175 as `activeProgress.subjects?.[slug]?.completed_lessons`.
  // The top-level completed_lessons is a vestigial empty array seeded by the
  // Express server and preserved forever by the `{...activeProgress}` spread.
  // Reading it instead of `subjects` silently discarded every checkmark.
  // The `subjects` map is stored verbatim so get/put are exact inverses.

  async 'progress.get'({ slug }) {
    const row = unwrap(
      await supabase.from('otter_progress').select('completed_lessons, last_accessed')
        .eq('course_id', slug).maybeSingle())
    const stored = row?.completed_lessons ?? {}
    const subjects = {}
    for (const [subjectSlug, value] of Object.entries(stored)) {
      // Tolerate the flat array form the migration tool writes under '_legacy'.
      subjects[subjectSlug] = Array.isArray(value)
        ? { completed_lessons: value, last_accessed: row?.last_accessed ?? null }
        : {
            completed_lessons: Array.isArray(value?.completed_lessons) ? value.completed_lessons : [],
            last_accessed: value?.last_accessed ?? null,
          }
    }
    return {
      completed_lessons: [],
      last_accessed: row?.last_accessed ?? null,
      subjects,
    }
  },

  async 'progress.put'({ slug, body }) {
    const uid = await currentUserId()
    if (!uid) throw new OtterCloudError('not signed in', 401)
    const subjects = (body?.subjects && typeof body.subjects === 'object') ? body.subjects : {}
    // otter_progress_course_user_uidx is a FULL unique index, so upsert can
    // infer it here (unlike otter_subjects — see subject.save).
    unwrap(await supabase.from('otter_progress').upsert({
      course_id: slug,
      user_id: uid,
      completed_lessons: subjects,
      last_accessed: body?.last_accessed ?? new Date().toISOString(),
    }, { onConflict: 'course_id,user_id' }))
    return { ok: true }
  },

  // ── quiz history (migration 0045) ─────────────────────────────────────────
  //
  // ONE personal history, not one per course. `quiz.get`/`quiz.put` used to
  // live here reading otter_progress.quiz_attempts; both are gone with the
  // column, because a quiz is built from whatever courses the user ticks and a
  // multi-course attempt has no single course_id to be keyed by. See 0045's
  // header — the old path was complete, tested, and had never been called.
  //
  // RLS supplies the 30-day window and the owner filter, so neither is
  // repeated here. A redundant client-side filter is this project's recurring
  // mistake: it closes a documented-looking gap and fixes nothing, while
  // making a future policy change silently ineffective.
  async 'quiz.list'() {
    const rows = unwrap(
      await supabase.from('otter_quiz_attempts').select(QUIZ_COLS)
        .order('taken_at', { ascending: false })) ?? []
    return { attempts: rows }
  },

  async 'quiz.add'({ body }) {
    const uid = await currentUserId()
    if (!uid) throw new OtterCloudError('not signed in', 401)

    // Validated here as well as by the CHECK constraints, so the caller gets a
    // sentence instead of a raw constraint name. Mirrors the Express handler.
    const total = Number(body?.total)
    const score = Number(body?.score)
    if (!Number.isInteger(total) || total <= 0) {
      throw new OtterCloudError('total must be a positive whole number', 400)
    }
    if (!Number.isInteger(score) || score < 0 || score > total) {
      throw new OtterCloudError('score must be between 0 and total', 400)
    }

    // Housekeeping, deliberately not fatal: clearing the expired tail is not
    // what the user asked for, and refusing to record their result because the
    // sweep failed would trade a real write for a tidy one. It needs the RPC
    // rather than a DELETE because otter_quiz_attempts_select hides expired
    // rows from a DELETE's own WHERE clause (0045's header).
    const { error: pruneError } = await supabase.rpc('otter_prune_quiz_attempts')
    if (pruneError) console.warn('quiz history prune failed:', pruneError.message)

    // workspace_id and user_id omitted: 0045 DEFAULTs them from the JWT, so a
    // client cannot mis-stamp tenancy or file an attempt against someone else.
    const row = unwrap(
      await supabase.from('otter_quiz_attempts')
        .insert({
          score,
          total,
          courses: Array.isArray(body?.courses) ? body.courses : [],
          question_types: Array.isArray(body?.question_types) ? body.question_types : [],
        })
        .select(QUIZ_COLS).single())
    return { ok: true, attempt: row }
  },

  // ── trash (Session 11, migration 0024) ────────────────────────────────────

  // Reads otter_trash_index() rather than otter_courses: every SELECT policy
  // on these tables begins `deleted_at IS NULL`, so a table read can never see
  // a trashed row. That is the whole reason 0024 exists.
  async 'trash.list'() {
    const rows = unwrap(await supabase.rpc('otter_trash_index')) ?? []
    return rows.map(r => ({
      id: r.id,
      kind: r.kind,
      course_id: r.course_id,
      course_name: r.course_name,
      name: r.name,
      slug: r.slug,
      visibility: r.visibility,
      owner_id: r.owner_id,
      owner_label: r.owner_label,
      is_own: r.is_own,
      subject_count: r.subject_count ?? 0,
      deleted_at: r.deleted_at,
      deleted_by_label: r.deleted_by_label,
      purges_at: r.purges_at,
    }))
  },

  async 'trash.restore'({ body }) {
    const table = body?.kind === 'subject' ? 'otter_subjects' : 'otter_courses'
    const id = body?.id
    if (!id) throw new OtterCloudError('id required', 400)
    const { data, error } = await supabase.rpc('otter_restore_row', { p_table: table, p_id: id })
    if (error) {
      // otter_courses_owner_slug_uidx is PARTIAL (WHERE deleted_at IS NULL), so
      // restoring collides only when the owner has since made a new course of
      // the same name. Postgres reports a bare 23505; the user needs the reason.
      if (error.code === '23505') {
        throw new OtterCloudError(
          'You already have a course with this name. Rename that one first, then restore.', 409)
      }
      throw new OtterCloudError(error.message, 500)
    }
    // The RPC returns false when it matched nothing — already restored, or
    // purged out from under the list. Not an error, but not a success either.
    return { ok: data === true, restored: data === true }
  },

  // ── forking (Session 11) ──────────────────────────────────────────────────

  // "Use the company standard instead of generating." Always yields a PERSONAL
  // copy owned by the caller (enforced inside otter_fork_course), so taking a
  // copy can never republish anything.
  async 'course.fork'({ slug, body }) {
    const newId = unwrap(await supabase.rpc('otter_fork_course', {
      p_course_id: slug,
      p_new_name: body?.name ?? null,
    }))
    if (!newId) throw new OtterCloudError('fork failed', 500)
    return supabaseOtterAdapter['course.get']({ slug: newId })
  },

  // ── editor grants (Session 11) ────────────────────────────────────────────

  // Two round trips rather than a PostgREST embed. otter_course_editors joins
  // workspace_members on a COMPOSITE key (workspace_id, user_id); relying on
  // PostgREST to resolve that relationship is a silent-breakage risk for a
  // label, and the roster is a handful of rows.
  async 'editors.list'({ slug }) {
    const grants = unwrap(
      await supabase.from('otter_course_editors')
        .select('user_id, granted_by, created_at')
        .eq('course_id', slug)) ?? []
    if (grants.length === 0) return []
    const ids = [...new Set(grants.map(g => g.user_id))]
    const people = unwrap(
      await supabase.from('workspace_members')
        .select('user_id, username, display_name, is_active')
        .in('user_id', ids)) ?? []
    const byId = new Map(people.map(p => [p.user_id, p]))
    return grants.map(g => {
      const p = byId.get(g.user_id)
      return {
        user_id: g.user_id,
        label: p?.display_name || p?.username || 'Unknown member',
        is_active: p?.is_active ?? true,
        granted_by: g.granted_by,
        created_at: g.created_at,
      }
    })
  },

  async 'editors.add'({ slug, body }) {
    const userId = body?.user_id
    if (!userId) throw new OtterCloudError('user_id required', 400)
    // workspace_id MUST be sent: this table has no DEFAULT for it, unlike every
    // other O.T.T.E.R. table. See currentWorkspaceId() above. The value is not
    // trusted — fn_otter_editor_grant_workspace re-checks it against the
    // course's workspace and raises on a mismatch, and the RLS WITH CHECK
    // requires `workspace_id = current_workspace_id()` independently.
    const workspaceId = await currentWorkspaceId()
    if (!workspaceId) throw new OtterCloudError('not signed in to a workspace', 401)
    const { error } = await supabase.from('otter_course_editors')
      .insert({ workspace_id: workspaceId, course_id: slug, user_id: userId })
    if (error) {
      if (error.code === '23505') return { ok: true, already: true }
      // The one refusal worth naming: 0022 forbids an admin granting on a
      // PERSONAL course (otherwise index -> self-grant -> read defeats the
      // no-admin-bypass rule). A bare RLS message would read as a bug.
      if (error.code === '42501') {
        throw new OtterCloudError(
          'Only the owner can give someone edit access to a personal course.', 403)
      }
      throw new OtterCloudError(error.message, 500)
    }
    return { ok: true }
  },

  async 'editors.remove'({ slug, userId }) {
    if (!userId) throw new OtterCloudError('user_id required', 400)
    const rows = unwrap(
      await supabase.from('otter_course_editors').delete()
        .eq('course_id', slug).eq('user_id', userId)
        .select('user_id')) ?? []
    // A refused DELETE affects 0 rows and returns no error — the same trap as
    // a refused UPDATE. Report it rather than showing the grant as revoked.
    if (rows.length === 0) throw new OtterCloudError('not allowed to revoke this grant', 403)
    return { ok: true }
  },

  // ── change requests (Session 11) ──────────────────────────────────────────

  // otter_cr_select already scopes this to the proposer, admins, and the target
  // course's owner, so an unfiltered read returns exactly the caller's queue.
  async 'cr.list'() {
    const rows = unwrap(
      await supabase.from('otter_change_requests')
        .select('id, target_course_id, source_course_id, proposed_by, summary, status, reviewed_by, reviewed_at, review_note, revision, applied_at, applied_by, archive_course_id, acknowledged_at, created_at, updated_at')
        .order('created_at', { ascending: false })) ?? []
    if (rows.length === 0) return []

    // Labels come from the index the caller can already see. Since 0025 a
    // reviewer's index includes the proposer's source course while the request
    // is open or changes_requested (the consented review window), so
    // source_readable is true exactly when "Open their course" would work.
    const courses = unwrap(await supabase.rpc('otter_course_index')) ?? []
    const courseById = new Map(courses.map(c => [c.id, c]))
    const ids = [...new Set(rows.flatMap(r => [r.proposed_by, r.reviewed_by]).filter(Boolean))]
    const people = ids.length
      ? (unwrap(await supabase.from('workspace_members')
          .select('user_id, username, display_name').in('user_id', ids)) ?? [])
      : []
    const label = (id) => {
      const p = people.find(x => x.user_id === id)
      return p ? (p.display_name || p.username) : null
    }

    return rows.map(r => ({
      ...r,
      target_name: courseById.get(r.target_course_id)?.name ?? null,
      source_name: courseById.get(r.source_course_id)?.name ?? null,
      source_readable: courseById.get(r.source_course_id)?.can_read_content === true,
      proposer_label: label(r.proposed_by),
      reviewer_label: label(r.reviewed_by),
    }))
  },

  async 'cr.create'({ body }) {
    const summary = (body?.summary ?? '').trim()
    if (!summary) throw new OtterCloudError('summary required', 400)
    if (!body?.target_course_id) throw new OtterCloudError('target_course_id required', 400)
    const { data, error } = await supabase.from('otter_change_requests')
      .insert({
        target_course_id: body.target_course_id,
        source_course_id: body.source_course_id ?? null,
        summary,
      })
      .select('id, status, created_at').single()
    if (error) {
      if (error.code === '42501') {
        throw new OtterCloudError(
          'Change requests can only be raised against a company standard course.', 403)
      }
      throw new OtterCloudError(error.message, 500)
    }
    return data
  },

  // Approve / reject / withdraw / refine. fn_otter_cr_review owns the rules —
  // it stamps the reviewer, refuses to re-decide a settled request, and strips
  // review fields a proposer tries to write. The client only sends intent.
  async 'cr.update'({ id, body }) {
    const patch = {}
    if (body?.status != null)      patch.status = body.status
    if (body?.summary != null)     patch.summary = body.summary
    if (body?.review_note != null) patch.review_note = body.review_note
    if (Object.keys(patch).length === 0) throw new OtterCloudError('nothing to update', 400)

    const { data, error } = await supabase.from('otter_change_requests')
      .update(patch).eq('id', id)
      .select('id, status, reviewed_by, reviewed_at, review_note, summary').maybeSingle()
    if (error) {
      // The trigger raises plain text for a re-decide attempt; pass it through,
      // it is already written for a human.
      throw new OtterCloudError(error.message, 409)
    }
    // 0 rows = RLS refused. Without this the UI would show a request as
    // approved while the row never moved (the 204-on-refusal trap).
    if (!data) throw new OtterCloudError('not allowed to change this request', 403)
    return data
  },

  // Session 13: approve = APPLY (locked #22). otter_cr_apply archives the
  // target into a personal copy owned by the approver, copies the proposer's
  // live subjects into the target additively (update by slug, insert when
  // absent, never delete), and settles the request, all in one transaction.
  // Returns the archive course id.
  //
  // A4 / Audrey's decision 37: the four reference documents now move too. The
  // merge stays in CLIENT JS rather than moving into the RPC — §6 #29's
  // objection is that reimplementing mergeHotkeys/mergeFunctions/mergeNodes in
  // plpgsql duplicates load-bearing logic, and it still stands.
  //
  // 🚨 THE FORK'S DOCUMENTS ARE READ BEFORE THE RPC, AND THAT ORDER IS THE
  //    WHOLE DESIGN. Deciding CLOSES the consented review window
  //    (otter_has_open_review_access opens on submit and closes on settle), so
  //    the instant the RPC returns, the approver can no longer read the
  //    proposer's course at all. Reading after would return nothing, merge
  //    nothing, and report success.
  //
  // 🚨 THE ARCHIVE KEEPS THE OLD DOCUMENTS FOR FREE, and only because the merge
  //    runs AFTER the RPC. otter_fork_course copies hotkeys/functions/nodes/
  //    reference_urls off the target (verified against the deployed body, not
  //    the comment), and the RPC never touches those columns — so the snapshot
  //    it takes is the pre-merge standard. Moving this merge before the RPC
  //    would silently put the NEW documents in the archive.
  //
  // ⚠️ PARTIAL FAILURE IS REPORTED, NOT SWALLOWED. The RPC has already
  //    committed by the time these writes run, so a refused document write
  //    cannot roll the approval back. otter_courses_update's WITH CHECK
  //    requires current_app_role() = 'admin' to write a company_standard
  //    course, while the RPC also admits the standard's OWNER — so a non-admin
  //    owner approving (not reachable from the Admin Terminal, which is
  //    admin-only, but reachable by calling the RPC directly) gets the subjects
  //    and not the documents. The caller is told which ones failed.
  async 'cr.approve'({ id }) {
    const cr = unwrap(await supabase.from('otter_change_requests')
      .select('id, source_course_id, target_course_id').eq('id', id).maybeSingle())
    if (!cr) throw new OtterCloudError('that change request is no longer visible', 404)

    // FAIL CLOSED, and deliberately. `unwrap` THROWS on a read error, so a
    // transient failure here aborts the approval BEFORE the RPC runs and nothing
    // is written at all. That is the right way round: after the RPC the review
    // window is closed and these documents can never be read again, so approving
    // first and discovering the read failed second would lose them permanently.
    // The approver can simply try again.
    const forkDocs = {}
    for (const doc of Object.keys(CR_DOC_MERGE)) {
      const { column, empty } = COURSE_DOCS[doc]
      const row = unwrap(await supabase.from('otter_courses')
        .select(column).eq('id', cr.source_course_id).maybeSingle())
      // 🚨 NO ROW IS NOT AN EMPTY DOCUMENT. `row?.[column] ?? empty` alone cannot
      // tell "the fork is invisible to me" from "the fork has no hotkeys", and the
      // first one silently merges nothing into all four columns while every write
      // succeeds and the banner reports a clean merge — the same silent success the
      // read-before-RPC ordering exists to prevent, reached by a different door.
      if (!row) {
        // WHY it is invisible decides what to say. The review window is open
        // only while the request is (otter_has_open_review_access, 0025), so the
        // commonest cause by far is that a second reviewer decided it first — an
        // ordinary lost race, not a permissions problem. Saying "could not read"
        // there sends the approver looking for an access fault that is not real,
        // so re-read the status and name what actually happened. One extra query,
        // on a path that is already failing.
        const settled = await supabase.from('otter_change_requests')
          .select('status').eq('id', id).maybeSingle()
        const status = settled?.data?.status
        if (status && status !== 'open' && status !== 'changes_requested') {
          throw new OtterCloudError(
            'this request is already ' + status + ' — someone else decided it first', 409)
        }
        throw new OtterCloudError(
          'could not read the proposer' + String.fromCharCode(39) + 's course — nothing has been changed', 403)
      }
      forkDocs[doc] = row[column] ?? empty
    }

    const { data, error } = await supabase.rpc('otter_cr_apply', { p_cr_id: id })
    if (error) {
      // Every refusal the RPC raises is already written for a person
      // ("the target is no longer the company standard — …"); pass it through.
      throw new OtterCloudError(error.message, 409)
    }

    const documents = { merged: [], failed: [] }
    for (const [doc, merge] of Object.entries(CR_DOC_MERGE)) {
      const { column, empty } = COURSE_DOCS[doc]
      try {
        const cur = unwrap(await supabase.from('otter_courses')
          .select(column).eq('id', cr.target_course_id).maybeSingle())
        // Same trap, and worse on this side: treating an unreadable standard as an
        // EMPTY one would merge the fork into nothing and then WRITE that back,
        // replacing the standard's own documents with only the proposer's. That is
        // the additive rule broken silently, so refuse this document instead.
        if (!cur) throw new OtterCloudError('could not read the standard course', 403)
        const merged = merge(cur[column] ?? empty, forkDocs[doc])
        // `.select('id').maybeSingle()` is load-bearing: an UPDATE that RLS
        // refuses affects 0 rows and PostgREST answers 204 with NO error, so a
        // bare update reports success and the documents silently do not move.
        const row = unwrap(await supabase.from('otter_courses')
          .update({ [column]: merged }).eq('id', cr.target_course_id)
          .select('id').maybeSingle())
        if (!row) throw new OtterCloudError('not allowed to edit the standard course', 403)
        documents.merged.push(doc)
      } catch (err) {
        documents.failed.push({ doc, message: err?.message ?? String(err) })
      }
    }

    return { ok: true, archive_course_id: data, documents }
  },

  // ── company-standard nominations (0064) ───────────────────────────────────
  // The sibling of cr.* for "make MY course the standard". Two differences from
  // change requests, both deliberate and both enforced server-side:
  //   * anyone may propose a course they OWN — there is no pre-existing target;
  //   * admins AND MANAGERS decide. A manager still cannot decide a change
  //     request; 0064 widened only this flow.

  async 'nomination.list'() {
    const rows = unwrap(
      await supabase.from('otter_course_nominations')
        .select('id, course_id, proposed_by, summary, status, reviewed_by, reviewed_at, review_note, revision, applied_at, applied_by, superseded_course_id, acknowledged_at, created_at, updated_at')
        .order('created_at', { ascending: false })) ?? []
    if (rows.length === 0) return []

    // Labels come from the index the caller can already see. Since 0064 an
    // approver's index includes the nominated course while the nomination is
    // open or changes_requested (the consented window), so course_readable is
    // true exactly when "Open their course" would work.
    const courses = unwrap(await supabase.rpc('otter_course_index')) ?? []
    const courseById = new Map(courses.map(c => [c.id, c]))
    const ids = [...new Set(rows.flatMap(r => [r.proposed_by, r.reviewed_by]).filter(Boolean))]
    const people = ids.length
      ? (unwrap(await supabase.from('workspace_members')
          .select('user_id, username, display_name').in('user_id', ids)) ?? [])
      : []
    const label = (id) => {
      const p = people.find(x => x.user_id === id)
      return p ? (p.display_name || p.username) : null
    }

    return rows.map(r => ({
      ...r,
      course_name: courseById.get(r.course_id)?.name ?? null,
      course_readable: courseById.get(r.course_id)?.can_read_content === true,
      course_visibility: courseById.get(r.course_id)?.visibility ?? null,
      superseded_name: r.superseded_course_id
        ? (courseById.get(r.superseded_course_id)?.name ?? null)
        : null,
      proposer_label: label(r.proposed_by),
      reviewer_label: label(r.reviewed_by),
    }))
  },

  // Only course_id and summary are the client's to send. workspace_id and
  // proposed_by DEFAULT server-side (0064) precisely so a proposer cannot file
  // as someone else or into another workspace.
  async 'nomination.create'({ body }) {
    const summary = (body?.summary ?? '').trim()
    if (!summary) throw new OtterCloudError('summary required', 400)
    if (!body?.course_id) throw new OtterCloudError('course_id required', 400)
    const { data, error } = await supabase.from('otter_course_nominations')
      .insert({ course_id: body.course_id, summary })
      .select('id, status, revision, created_at').single()
    if (error) {
      // The partial unique index, surfaced as the thing the user should do next
      // rather than as "duplicate key value violates unique constraint".
      if (error.code === '23505') {
        throw new OtterCloudError(
          'This course is already put forward. Open Requests to edit or withdraw it.', 409)
      }
      if (error.code === '42501') {
        throw new OtterCloudError(
          'You can only put forward a course you own, and it cannot already be the company standard.', 403)
      }
      throw new OtterCloudError(error.message, 500)
    }
    return data
  },

  // Decline / withdraw / refine / resubmit / accept. fn_otter_nomination_review
  // owns the rules — it stamps the reviewer, refuses to re-decide a settled
  // nomination, and strips decision fields a proposer tries to write. The
  // client only sends intent.
  async 'nomination.update'({ id, body }) {
    const patch = {}
    if (body?.status != null)      patch.status = body.status
    if (body?.summary != null)     patch.summary = body.summary
    if (body?.review_note != null) patch.review_note = body.review_note
    if (Object.keys(patch).length === 0) throw new OtterCloudError('nothing to update', 400)

    const { data, error } = await supabase.from('otter_course_nominations')
      .update(patch).eq('id', id)
      .select('id, status, reviewed_by, reviewed_at, review_note, summary, revision').maybeSingle()
    if (error) {
      // The trigger raises plain text written for a person; pass it through.
      throw new OtterCloudError(error.message, 409)
    }
    // 0 rows = RLS refused. Without this the UI would show a nomination as
    // declined while the row never moved (the 204-on-refusal trap).
    if (!data) throw new OtterCloudError('not allowed to change this nomination', 403)
    return data
  },

  // Approve = PROMOTE. otter_nomination_apply demotes the incumbent standard
  // for this slug, promotes the nominated course, and settles the nomination in
  // one transaction. A bare status flip is refused by the trigger, because the
  // pin trigger would silently revert the visibility change and the approval
  // would record something that never happened.
  async 'nomination.approve'({ id }) {
    const { data, error } = await supabase.rpc('otter_nomination_apply', {
      p_nomination_id: id,
    })
    if (error) {
      // Every refusal the RPC raises is already written for a person ("there is
      // already a company standard called … under a different identifier").
      throw new OtterCloudError(error.message, 409)
    }
    return { ok: true, course_id: data }
  },

  // ── export ────────────────────────────────────────────────────────────────

  // 🚨 QUIZ HISTORY MOVED OUT OF THE PER-COURSE LOOP (S30), and the old shape
  // was not merely misplaced — it was a false claim. `quiz.get` was called
  // here, once per course, and it read a column NOTHING HAS EVER WRITTEN. So
  // every data export WILSON has produced carried an empty `quizHistory` on
  // every course while presenting itself as complete. An export is a claim
  // about completeness; that one was wrong for twenty sessions and the only
  // caller of the whole quiz path was this line.
  //
  // It is now one top-level key, matching Local Server's /api/export-all and
  // the fact that an attempt can span several courses.
  async 'export.all'() {
    const courses = await supabaseOtterAdapter['course.list']()
    const software = []
    for (const c of courses) {
      if (c.can_read_content === false) continue // metadata-only rows carry no content
      const [meta, subjects, hotkeys, functions, nodes, progress] = await Promise.all([
        supabaseOtterAdapter['course.get']({ slug: c.slug }),
        supabaseOtterAdapter['subject.list']({ slug: c.slug }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'hotkeys' }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'functions' }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'nodes' }),
        supabaseOtterAdapter['progress.get']({ slug: c.slug }),
      ])
      const full = []
      for (const s of subjects) {
        full.push(await supabaseOtterAdapter['subject.get']({ slug: c.slug, sub: s.slug }))
      }
      software.push({ meta, hotkeys, functions, nodes, progress, subjects: full })
    }
    const quizHistory = await supabaseOtterAdapter['quiz.list']()
    return {
      version: '2.0',
      exported_at: new Date().toISOString(),
      quiz_history: quizHistory.attempts ?? [],
      software,
    }
  },
}

export { OtterCloudError }
