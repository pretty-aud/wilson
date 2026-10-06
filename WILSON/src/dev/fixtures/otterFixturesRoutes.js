// =============================================================================
// otterFixturesRoutes.js — otterFetch's route handler over the fixture store.
//
// Keyed by the `op` otterRoutes.parseOtterRoute() produces, answering the
// EXACT wire shapes supabaseOtterAdapter.js documents (which are the Express
// server's), so Otter.jsx, Validator.jsx and SettingsPage keep working
// unchanged. Course and subject writes mutate the store; the workspace-only
// flows that have no meaning on fixture data (forking, editor grants, change
// requests, nominations) are refused loudly.
// =============================================================================

import { COURSE_DOCS, DOC_MERGERS, migrateNodesData, slugify } from '../../tools/otter_v0.3.1/adapters/otterRoutes'
import { devWriteRefused } from '../devFixtures'
import { clone, newId, now, findById } from './store'

const VISIBILITIES = new Set(['personal', 'shared', 'company_standard'])

class FixturesRouteError extends Error {
  constructor(message, status = 500) { super(message); this.status = status }
}

function toCourseWire(row, { userId }, extra = {}) {
  return {
    slug: row.id,
    name: row.name,
    type: row.course_type ?? 'software',
    skill_level: row.skill_level ?? 'beginner',
    created_at: row.created_at,
    visibility: row.visibility,
    owner_id: row.owner_id,
    owner_label: extra.owner_label ?? null,
    is_own: row.owner_id === userId,
    can_write: true,
    can_read_content: true,
    source_course_id: row.source_course_id ?? null,
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

export function createOtterFixturesHandler(store, { userId, workspaceId }) {
  const courseOr404 = (slug) => {
    const c = findById(store.courses, slug)
    if (!c || c.deleted_at) throw new FixturesRouteError('Not found', 404)
    return c
  }
  const subjectsOf = (courseId) => store.subjects
    .filter(s => s.course_id === courseId && !s.deleted_at)
    .sort((a, b) => a.subject_order - b.subject_order)
  const ownerLabel = (ownerId) => store.members.find(m => m.user_id === ownerId)?.display_name ?? null

  const ops = {
    // ── courses ──────────────────────────────────────────────────────────────
    'course.list'() {
      return store.courses.filter(c => !c.deleted_at).map(c =>
        toCourseWire(c, { userId }, { subject_count: subjectsOf(c.id).length, owner_label: ownerLabel(c.owner_id) }))
    },
    'course.get'({ slug }) {
      const c = courseOr404(slug)
      return toCourseWire(c, { userId }, { owner_label: ownerLabel(c.owner_id) })
    },
    'course.create'({ body }) {
      const name = String(body?.name ?? '').trim()
      if (!name) throw new FixturesRouteError('name is required', 400)
      const row = {
        id: newId(), workspace_id: workspaceId, owner_id: userId,
        slug: slugify(name), name,
        course_type: body?.type ?? 'software',
        skill_level: body?.skill_level ?? 'beginner',
        visibility: VISIBILITIES.has(body?.visibility) ? body.visibility : 'personal',
        source_course_id: null,
        hotkeys: { categories: [] }, functions: { categories: [] }, nodes: { systems: [] },
        reference_urls: { urls: [] }, corrections: { corrections: [] },
        created_at: now(), updated_at: now(),
      }
      store.courses.push(row)
      return toCourseWire(row, { userId }, { subject_count: 0, owner_label: ownerLabel(userId) })
    },
    'course.update'({ slug, body }) {
      const c = courseOr404(slug)
      if (body?.name) c.name = String(body.name)
      if (body?.type) c.course_type = body.type
      if (body?.skill_level) c.skill_level = body.skill_level
      if (VISIBILITIES.has(body?.visibility)) c.visibility = body.visibility
      c.updated_at = now()
      return toCourseWire(c, { userId }, { subject_count: subjectsOf(c.id).length, owner_label: ownerLabel(c.owner_id) })
    },
    'course.delete'({ slug }) {
      const c = courseOr404(slug)
      c.deleted_at = now()
      for (const s of subjectsOf(c.id)) s.deleted_at = now()
      return { ok: true }
    },

    // ── subjects ─────────────────────────────────────────────────────────────
    'subject.list'({ slug }) {
      courseOr404(slug)
      return subjectsOf(slug).map(r => ({
        slug: r.slug, title: r.title || r.slug, description: r.description ?? '',
        skill_level: r.skill_level ?? 'beginner', is_stub: r.is_stub ?? false, subject_order: r.subject_order ?? 0,
      }))
    },
    'subject.get'({ slug, sub }) {
      courseOr404(slug)
      const row = subjectsOf(slug).find(s => s.slug === sub)
      if (!row) throw new FixturesRouteError('Not found', 404)
      return toSubjectWire(clone(row), slug)
    },
    'subject.save'({ slug, sub, body }) {
      courseOr404(slug)
      const subjectSlug = sub || slugify(body?.slug || body?.title || '')
      if (!subjectSlug) throw new FixturesRouteError('title is required', 400)
      let row = subjectsOf(slug).find(s => s.slug === subjectSlug)
      const fields = {
        title: body?.title ?? row?.title ?? subjectSlug,
        description: body?.description ?? row?.description ?? '',
        skill_level: body?.skill_level ?? row?.skill_level ?? 'beginner',
        is_stub: body?.is_stub ?? row?.is_stub ?? false,
        estimated_hours: body?.estimated_hours ?? row?.estimated_hours ?? null,
        sections: body?.sections ?? row?.sections ?? [],
        section_outlines: body?.section_outlines ?? row?.section_outlines ?? [],
        sources: body?.sources ?? row?.sources ?? [],
        prerequisites: body?.prerequisites ?? row?.prerequisites ?? [],
      }
      if (!row) {
        row = {
          id: newId(), workspace_id: workspaceId, course_id: slug, owner_id: userId, slug: subjectSlug,
          subject_order: subjectsOf(slug).length, deleted_at: null, created_at: now(), ...fields, updated_at: now(),
        }
        store.subjects.push(row)
      } else {
        Object.assign(row, fields, { updated_at: now() })
      }
      return toSubjectWire(clone(row), slug)
    },
    'subject.delete'({ slug, sub }) {
      courseOr404(slug)
      const row = subjectsOf(slug).find(s => s.slug === sub)
      if (!row) throw new FixturesRouteError('Not found', 404)
      row.deleted_at = now()
      return { ok: true }
    },
    'subject.renumber'({ slug }) {
      subjectsOf(slug).forEach((s, i) => { s.subject_order = i })
      return { ok: true }
    },
    'subject.reorder'({ slug, body }) {
      const order = Array.isArray(body?.order) ? body.order : Array.isArray(body) ? body : []
      const rows = subjectsOf(slug)
      order.forEach((subjectSlug, i) => { const r = rows.find(s => s.slug === subjectSlug); if (r) r.subject_order = i })
      return { ok: true }
    },

    // ── per-course documents ─────────────────────────────────────────────────
    'doc.get'({ slug, doc }) {
      const { column, empty } = COURSE_DOCS[doc]
      const c = courseOr404(slug)
      const value = c[column] ?? empty
      return clone(doc === 'nodes' ? migrateNodesData(value) : value)
    },
    'doc.put'({ slug, doc, body }) {
      const { column } = COURSE_DOCS[doc]
      const c = courseOr404(slug)
      c[column] = clone(body ?? COURSE_DOCS[doc].empty)
      c.updated_at = now()
      return clone(c[column])
    },
    'doc.merge'({ slug, doc, body }) {
      const { column, empty } = COURSE_DOCS[doc]
      const merge = DOC_MERGERS[doc]
      const c = courseOr404(slug)
      const incoming = Array.isArray(body) ? body : (body?.[doc] ?? body?.categories ?? body?.corrections ?? [])
      c[column] = merge ? merge(c[column] ?? empty, incoming) : clone(body)
      c.updated_at = now()
      return clone(c[column])
    },

    // ── progress and quiz history ────────────────────────────────────────────
    'progress.get'({ slug }) {
      const row = store.progress[slug]
      const stored = row?.completed_lessons ?? {}
      const subjects = {}
      for (const [subjectSlug, value] of Object.entries(stored)) {
        subjects[subjectSlug] = Array.isArray(value)
          ? { completed_lessons: value, last_accessed: row?.last_accessed ?? null }
          : { completed_lessons: Array.isArray(value?.completed_lessons) ? value.completed_lessons : [], last_accessed: value?.last_accessed ?? null }
      }
      return { completed_lessons: [], last_accessed: row?.last_accessed ?? null, subjects: clone(subjects) }
    },
    'progress.put'({ slug, body }) {
      const row = store.progress[slug] || (store.progress[slug] = { course_id: slug, completed_lessons: {}, last_accessed: null })
      const subjectSlug = body?.subject_slug || body?.subject
      if (subjectSlug) {
        row.completed_lessons[subjectSlug] = {
          completed_lessons: Array.isArray(body?.completed_lessons) ? body.completed_lessons : [],
          last_accessed: now(),
        }
      } else if (body && typeof body === 'object' && body.subjects) {
        row.completed_lessons = clone(body.subjects)
      }
      row.last_accessed = now()
      return ops['progress.get']({ slug })
    },
    'quiz.list'() {
      return { attempts: clone([...store.quizAttempts].sort((a, b) => b.taken_at.localeCompare(a.taken_at))) }
    },
    'quiz.add'({ body }) {
      const row = {
        id: newId(), taken_at: now(),
        score: Number(body?.score ?? 0), total: Number(body?.total ?? 0),
        courses: Array.isArray(body?.courses) ? body.courses : [],
        question_types: Array.isArray(body?.question_types) ? body.question_types : [],
      }
      store.quizAttempts.push(row)
      return clone(row)
    },

    // ── workspace-only surfaces: honest empties, refused writes ──────────────
    'trash.list'() { return [] },
    'trash.restore'() { throw devWriteRefused('Restoring from the O.T.T.E.R. trash') },
    'course.fork'() { throw devWriteRefused('Forking a course') },
    'editors.list'() { return [] },
    'editors.add'() { throw devWriteRefused('Granting an editor') },
    'editors.remove'() { throw devWriteRefused('Revoking an editor') },
    'cr.list'() { return [] },
    'cr.create'() { throw devWriteRefused('Filing a change request') },
    'cr.update'() { throw devWriteRefused('Updating a change request') },
    'cr.approve'() { throw devWriteRefused('Approving a change request') },
    'nomination.list'() { return [] },
    'nomination.create'() { throw devWriteRefused('Nominating a course') },
    'nomination.update'() { throw devWriteRefused('Updating a nomination') },
    'nomination.approve'() { throw devWriteRefused('Approving a nomination') },

    'export.all'() {
      const software = ops['course.list']().map(c => ({
        meta: ops['course.get']({ slug: c.slug }),
        hotkeys: ops['doc.get']({ slug: c.slug, doc: 'hotkeys' }),
        functions: ops['doc.get']({ slug: c.slug, doc: 'functions' }),
        nodes: ops['doc.get']({ slug: c.slug, doc: 'nodes' }),
        progress: ops['progress.get']({ slug: c.slug }),
        subjects: ops['subject.list']({ slug: c.slug }).map(s => ops['subject.get']({ slug: c.slug, sub: s.slug })),
      }))
      return { version: '2.0', exported_at: now(), quiz_history: ops['quiz.list']().attempts, software }
    },
  }

  /**
   * @param {{op: string}} route  from parseOtterRoute
   * @param {any} body            the parsed request body
   * @returns {{ status: number, body: any }}
   */
  function handle(route, body) {
    const fn = ops[route?.op]
    if (typeof fn !== 'function') return { status: 501, body: { error: `unsupported O.T.T.E.R. route: ${route?.op}` } }
    try {
      return { status: 200, body: fn({ ...route, body }) }
    } catch (err) {
      const status = err?.status ?? 500
      return { status, body: { error: err?.message ?? 'O.T.T.E.R. fixtures request failed' } }
    }
  }

  return { handle, ops }
}
