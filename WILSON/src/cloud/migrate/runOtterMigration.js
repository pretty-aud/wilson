// =============================================================================
// runOtterMigration — local otter-data/ → cloud (Session 10).
//
// Reads every course from the in-app Express backend (which serves
// {userData}/otter-data/software/{slug}/...) and writes it into the migration
// 0022 tables, scoped by RLS to the caller's workspace.
//
// Same contract as runMigration.js: idempotent, resumable, dry-runnable, and
// streaming progress through an onProgress callback.
//
// Three things differ from the RABBIT runner and matter:
//
//  1. It reads with RAW fetch, never otterFetch. otterFetch routes to the CLOUD
//     as soon as a workspace session exists — which is exactly when a migration
//     runs — so using it would copy the cloud onto itself and report success.
//
//  2. Idempotency keys on the NATURAL key, not the id. Local courses have no
//     surrogate ids at all; identity is slugify(name). The partial unique index
//     otter_courses_owner_slug_uidx (workspace_id, owner_id, slug) is what makes
//     a re-run raise 23505 instead of duplicating, exactly like the RABBIT
//     runner's primary-key collisions.
//
//  3. Progress re-keys. On disk _progress.json sits in the course directory and
//     is a flat { completed_lessons: [...] }; in the cloud a progress row is
//     per (course, user) and completed_lessons is keyed BY SUBJECT, because a
//     lesson id like "lesson_1_1" is only unique within its own subject. A flat
//     legacy list is therefore imported under a '_legacy' key rather than
//     silently scattered across subjects it may not belong to.
//
// Reference-page text is deliberately NOT migrated: _references.json caches up
// to ~8 KB of scraped third-party page content per URL, which is regenerable
// and does not belong in a shared multi-tenant database. Only { url, title }
// crosses over.
// =============================================================================

import { supabase } from '../auth/supabaseClient'

const OTTER_BASE = '/api/software'

/** Raw fetch — see note 1 in the header. Never swap this for otterFetch. */
async function getLocal(path, fallback = null) {
  try {
    const res = await fetch(path)
    if (!res.ok) return fallback
    return await res.json()
  } catch {
    return fallback
  }
}

function makeReport() {
  return {
    dryRun: false,
    workspaceId: null,
    courses:   { total: 0, inserted: 0, skipped: 0, failed: 0 },
    subjects:  { total: 0, inserted: 0, skipped: 0, failed: 0 },
    documents: { total: 0, inserted: 0, skipped: 0, failed: 0 },
    progress:  { total: 0, inserted: 0, skipped: 0, failed: 0 },
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

const bumpInserted = (b) => { b.total++; b.inserted++ }
const bumpSkipped  = (b) => { b.total++; b.skipped++ }
const bumpFailed   = (b) => { b.total++; b.failed++ }

/** Strip cached page text; keep only what a citation actually needs. */
function slimReferences(refs) {
  const urls = Array.isArray(refs?.urls) ? refs.urls : []
  return { urls: urls.map(u => ({ url: u?.url ?? '', title: u?.title ?? '' })).filter(u => u.url) }
}

/**
 * What _progress.json ACTUALLY contains at runtime:
 *
 *   { completed_lessons: [],            <- vestigial: seeded empty by the
 *     last_accessed: null,                 Express server (main.cjs:207) and
 *     subjects: {                          preserved forever by Otter.jsx's
 *       "<subject-slug>": {                `{...activeProgress}` spread
 *         completed_lessons: ["lesson_1_1", ...],
 *         last_accessed: "2026-07-01T..."
 *       }
 *     } }
 *
 * All real study data lives under `subjects` (Otter.jsx:2123-2138). Reading the
 * top-level `completed_lessons` finds the empty array on every real file, so a
 * migration keyed on it imports nothing and reports success — a year of study
 * silently not migrated. The per-subject objects are carried across verbatim so
 * the adapter's progress.get/put round-trip them without loss.
 */
function normaliseProgress(progress) {
  const subjects = progress?.subjects
  if (subjects && typeof subjects === 'object' && !Array.isArray(subjects)) {
    const out = {}
    for (const [slug, value] of Object.entries(subjects)) {
      const lessons = Array.isArray(value?.completed_lessons) ? value.completed_lessons : []
      if (lessons.length > 0) {
        out[slug] = { completed_lessons: lessons, last_accessed: value?.last_accessed ?? null }
      }
    }
    if (Object.keys(out).length > 0) return out
  }
  // Pre-`subjects` files: a flat list with no subject attribution. Lesson ids
  // are only unique WITHIN a subject, so scattering them would invent data —
  // park them under '_legacy' instead of guessing.
  const flat = progress?.completed_lessons
  if (Array.isArray(flat) && flat.length > 0) return { _legacy: { completed_lessons: flat, last_accessed: null } }
  if (flat && typeof flat === 'object' && !Array.isArray(flat)) return flat
  return {}
}

/** Latest per-subject timestamp, since the top-level one is always null. */
function derivedLastAccessed(progress) {
  const stamps = Object.values(progress?.subjects ?? {})
    .map(v => v?.last_accessed)
    .filter(Boolean)
    .sort()
  return stamps.length ? stamps[stamps.length - 1] : (progress?.last_accessed ?? null)
}

/**
 * Migrate local O.T.T.E.R. content into the caller's workspace.
 *
 * @param {object}   opts
 * @param {boolean} [opts.dryRun]     report what would happen, write nothing
 * @param {function}[opts.onProgress] called with a human-readable line per course
 * @param {string}  [opts.visibility] tier for migrated courses; defaults to
 *                                    'personal' — importing someone's private
 *                                    study material must never publish it.
 * @returns {Promise<object>} report
 */
export async function runOtterMigration({ dryRun = false, onProgress, visibility = 'personal' } = {}) {
  const report = makeReport()
  report.dryRun = dryRun
  const say = (line) => { try { onProgress?.(line) } catch { /* UI only */ } }

  const { data: userData } = await supabase.auth.getUser()
  const uid = userData?.user?.id
  if (!uid) {
    report.errors.push('Not signed in — cannot migrate.')
    report.finishedAt = new Date().toISOString()
    return report
  }

  const courses = await getLocal(OTTER_BASE, null)
  if (!Array.isArray(courses)) {
    report.errors.push('Could not read local O.T.T.E.R. data (is the in-app server running?)')
    report.finishedAt = new Date().toISOString()
    return report
  }

  say(`Found ${courses.length} local course(s).`)

  for (const listed of courses) {
    const slug = listed.slug
    say(`Migrating "${listed.name || slug}"…`)

    const [meta, subjectList, hotkeys, functions, nodes, references, corrections, progress] =
      await Promise.all([
        getLocal(`${OTTER_BASE}/${slug}`, {}),
        getLocal(`${OTTER_BASE}/${slug}/subjects`, []),
        getLocal(`${OTTER_BASE}/${slug}/hotkeys`, { categories: [] }),
        getLocal(`${OTTER_BASE}/${slug}/functions`, { categories: [] }),
        getLocal(`${OTTER_BASE}/${slug}/nodes`, { systems: [] }),
        getLocal(`${OTTER_BASE}/${slug}/references`, { urls: [] }),
        getLocal(`${OTTER_BASE}/${slug}/corrections`, { corrections: [] }),
        getLocal(`${OTTER_BASE}/${slug}/progress`, {}),
      ])

    if (dryRun) {
      // Count only totals. Claiming everything as "inserted" made a dry run on
      // an ALREADY-migrated workspace predict N inserts where the real run
      // performs N skips, which reads as "the first migration didn't take".
      report.courses.total++
      report.subjects.total += (subjectList?.length ?? 0)
      report.documents.total += 5
      if (Object.keys(normaliseProgress(progress)).length) report.progress.total++
      continue
    }

    // ── course ───────────────────────────────────────────────────────────────
    // workspace_id / owner_id are left to their column DEFAULTs so the database
    // stamps tenancy from the JWT (the client can never mis-scope a row).
    let courseId = null
    const { data: inserted, error: insErr } = await supabase
      .from('otter_courses')
      .insert({
        slug,
        name: meta?.name || listed.name || slug,
        course_type: meta?.type || listed.type || 'software',
        skill_level: meta?.skill_level || listed.skill_level || 'beginner',
        visibility,
        // Carry the real creation date across. fn_audit_touch only fills
        // created_at when it is NULL, so an explicit value survives — without
        // it every migrated course lands within the same second and the
        // newest-first course list comes back in arbitrary order.
        created_at: meta?.created_at || listed.created_at || undefined,
        hotkeys: hotkeys ?? { categories: [] },
        functions: functions ?? { categories: [] },
        nodes: nodes ?? { systems: [] },
        reference_urls: slimReferences(references),
        corrections: corrections ?? { corrections: [] },
      })
      .select('id')
      .single()

    if (!insErr) {
      courseId = inserted.id
      bumpInserted(report.courses)
      report.documents.total += 5
      report.documents.inserted += 5
    } else if (insErr.code === '23505') {
      // Already migrated — reuse the existing row and top up its children.
      const { data: existing } = await supabase
        .from('otter_courses').select('id')
        .eq('slug', slug).eq('owner_id', uid).is('deleted_at', null).maybeSingle()
      courseId = existing?.id ?? null
      bumpSkipped(report.courses)
      report.documents.total += 5
      report.documents.skipped += 5
    } else {
      bumpFailed(report.courses)
      report.errors.push(`course "${slug}": ${insErr.message}`)
      continue
    }

    if (!courseId) {
      report.errors.push(`course "${slug}": already present but not readable — skipped its subjects`)
      continue
    }

    // ── subjects ─────────────────────────────────────────────────────────────
    for (const s of (subjectList ?? [])) {
      const full = await getLocal(`${OTTER_BASE}/${slug}/subjects/${s.slug}`, null)
      if (!full) { bumpFailed(report.subjects); report.errors.push(`subject "${slug}/${s.slug}": unreadable`); continue }

      const { error } = await supabase.from('otter_subjects').insert({
        course_id: courseId,
        slug: s.slug,
        title: full.title || s.title || s.slug,
        description: full.description ?? '',
        skill_level: full.skill_level || 'beginner',
        is_stub: full.is_stub ?? false,
        subject_order: full.subject_order ?? s.subject_order ?? 0,
        estimated_hours: full.estimated_hours ?? null,
        sections: full.sections ?? [],
        section_outlines: full.section_outlines ?? [],
        sources: full.sources ?? [],
        prerequisites: full.prerequisites ?? [],
      })

      if (!error) bumpInserted(report.subjects)
      else if (error.code === '23505') bumpSkipped(report.subjects)
      else { bumpFailed(report.subjects); report.errors.push(`subject "${slug}/${s.slug}": ${error.message}`) }
    }

    // ── progress (per-user; see note 3) ──────────────────────────────────────
    const completed = normaliseProgress(progress)
    const lastAccessed = derivedLastAccessed(progress)
    if (Object.keys(completed).length > 0 || lastAccessed) {
      const { error } = await supabase.from('otter_progress').insert({
        course_id: courseId,
        user_id: uid,
        completed_lessons: completed,
        last_accessed: lastAccessed,
      })
      if (!error) bumpInserted(report.progress)
      else if (error.code === '23505') bumpSkipped(report.progress)
      else { bumpFailed(report.progress); report.errors.push(`progress "${slug}": ${error.message}`) }
    }
  }

  report.workspaceId = null
  report.finishedAt = new Date().toISOString()
  say(
    `Done — ${report.courses.inserted} course(s) migrated, ${report.courses.skipped} already present, ` +
    `${report.subjects.inserted} subject(s) migrated.` +
    (report.errors.length ? ` ${report.errors.length} problem(s).` : '')
  )
  return report
}
