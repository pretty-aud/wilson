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
import { COURSE_DOCS, DOC_MERGERS, migrateNodesData, slugify } from './otterRoutes.js'

/** Columns that make up a subject's list entry — deliberately excludes the
 *  fat `sections` blob so the sidebar never pulls whole courses. */
const SUBJECT_LIST_COLS =
  'id, slug, title, description, skill_level, is_stub, subject_order'
const SUBJECT_FULL_COLS =
  `${SUBJECT_LIST_COLS}, estimated_hours, sections, section_outlines, sources, prerequisites, created_at, updated_at`

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
          // New courses are always born personal; sharing is an explicit act.
          visibility: body?.visibility === 'shared' ? 'shared' : 'personal',
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

  async 'quiz.get'({ slug }) {
    const row = unwrap(
      await supabase.from('otter_progress').select('quiz_attempts')
        .eq('course_id', slug).maybeSingle())
    return { attempts: row?.quiz_attempts ?? [] }
  },

  async 'quiz.put'({ slug, body }) {
    const uid = await currentUserId()
    if (!uid) throw new OtterCloudError('not signed in', 401)
    unwrap(await supabase.from('otter_progress').upsert({
      course_id: slug,
      user_id: uid,
      quiz_attempts: body?.attempts ?? [],
    }, { onConflict: 'course_id,user_id' }))
    return { ok: true }
  },

  // ── export ────────────────────────────────────────────────────────────────

  async 'export.all'() {
    const courses = await supabaseOtterAdapter['course.list']()
    const software = []
    for (const c of courses) {
      if (c.can_read_content === false) continue // metadata-only rows carry no content
      const [meta, subjects, hotkeys, functions, nodes, progress, quizHistory] = await Promise.all([
        supabaseOtterAdapter['course.get']({ slug: c.slug }),
        supabaseOtterAdapter['subject.list']({ slug: c.slug }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'hotkeys' }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'functions' }),
        supabaseOtterAdapter['doc.get']({ slug: c.slug, doc: 'nodes' }),
        supabaseOtterAdapter['progress.get']({ slug: c.slug }),
        supabaseOtterAdapter['quiz.get']({ slug: c.slug }),
      ])
      const full = []
      for (const s of subjects) {
        full.push(await supabaseOtterAdapter['subject.get']({ slug: c.slug, sub: s.slug }))
      }
      software.push({ meta, hotkeys, functions, nodes, progress, quizHistory, subjects: full })
    }
    return { version: '2.0', exported_at: new Date().toISOString(), software }
  },
}

export { OtterCloudError }
