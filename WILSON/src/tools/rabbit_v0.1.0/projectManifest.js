// ============================================================
// RABBIT — projectManifest
// ============================================================
//
// Session 26. The project folder carries a readable file describing the
// project itself.
//
// Audrey, 2026-08-03: "a lot of these project specific details like unique
// margin, unique contingency, unique team member rates, all project details
// in the project panel should be saved in the project folder as a file the
// system can read."
//
// ✅ DECIDED (Audrey, 2026-08-03) and settled: THE DATABASE IS AUTHORITATIVE
// AND THIS FILE IS A GENERATED MIRROR. Written whenever settings change;
// read only for portability, recovery and handoff; never an input to normal
// operation. Any import is an explicit user action that shows a diff first.
//
// The reason, so it is not re-litigated: RLS, realtime and last-writer-wins
// all assume a single authority. The moment a file can write back, two people
// editing in two places produce a silent overwrite where the loser is
// whoever's edit landed second, with no record of it. `main`'s `_DATABASES/`
// folder is the cautionary tale — it was a real second datastore.
//
//
// 🚨 WHAT IS DELIBERATELY NOT IN HERE, AND WHY IT IS THE ONE PART OF AUDREY'S
// REQUEST THIS SESSION DID NOT DELIVER.
//
// "unique team member rates" are `project_rate_overrides`. MEASURED against
// wilson-dev, 2026-08-04:
//
//   project_rate_overrides_select
//     :: workspace_id = current_workspace_id()
//        AND can_access_project_money(project_id)          <- MANAGER ONLY
//
//   storage policy rabbit_files_select
//     :: bucket_id = 'rabbit-files' AND authenticated
//        AND foldername[1] = 'projects'
//        AND upper(foldername[3]) IS DISTINCT FROM 'INVOICES'
//        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = foldername[2])
//
// A manifest at `projects/<id>/PROJECT.json` has no third path segment, so
// `upper(NULL) IS DISTINCT FROM 'INVOICES'` is true and the BASE policy
// applies: every project member can download it. Putting per-member rates in
// it would hand every team member the exact figures RLS had just denied them.
// That is the same defect S24 found and closed for invoice PDFs — "the amount
// is useless to hide if the invoice stating it is readable".
//
// The project ROW is different and was checked separately: projects_select
// admits any active workspace member, so budget_margin_pct,
// budget_contingency_pct and the rest are ALREADY readable by everyone who
// can open the project. Mirroring them here leaks nothing new, which is why
// margin and contingency — two of the three things Audrey named — ARE here.
//
// → Rates need a money-gated path of their own. INVOICES is the only gated
//   segment that exists, and a rates file inside a folder called INVOICES is
//   not something to inflict on someone browsing their own project. Designing
//   a second gated namespace is a storage-policy change, and the
//   0038-shipped-it-lowercase / 0039-had-to-fix-it episode is the standing
//   evidence that getting one wrong inverts the gate silently. It belongs
//   with S27, which owns file paths. Audrey's call either way.

/** Bumped when the SHAPE changes, so an importer can refuse what it cannot read. */
export const MANIFEST_VERSION = 1

/** The file's name inside the project folder. */
export const MANIFEST_FILENAME = 'PROJECT.json'

// Audit plumbing that means nothing outside the database. Kept out so the
// file reads like a description of the project rather than a table dump.
const OMIT_FROM_PROJECT = new Set([
  'workspace_id', 'created_by', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
  // D.O.G.'s unified-store fields ride on the project object in memory but
  // are not columns; they are content, not settings.
  'documents', 'visualAssets',
])

function projectSettings(project) {
  const out = {}
  for (const [k, v] of Object.entries(project || {})) {
    if (OMIT_FROM_PROJECT.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Build the manifest. Pure — takes a loaded bundle, returns an object.
 *
 * `generatedAt` is a parameter rather than a `new Date()` inside, so the
 * caller owns the clock and the function stays testable.
 */
export function buildProjectManifest(project, bundle = {}, generatedAt = null) {
  const folders = (bundle.folders || []).map(f => ({
    kind:        f.kind,
    path:        f.path,
    slug:        f.slug,
    label:       f.label || null,
    entity_type: f.entity_type || null,
  })).sort((a, b) => a.path.localeCompare(b.path))

  return {
    wilson_manifest_version: MANIFEST_VERSION,
    generated_at: generatedAt,

    // 🚨 Stated IN the file, not only in this comment. Someone finding this
    // on a drive in a year has no access to the reasoning above, and the one
    // thing they must not do is edit it expecting WILSON to notice.
    authority: 'database',
    note:
      'Generated MIRROR of the project settings held in WILSON. The database '
      + 'is authoritative: editing this file changes nothing. It exists for '
      + 'portability, recovery and handoff. Importing it is an explicit action '
      + 'in WILSON that shows a diff first.',
    omitted:
      'Per-member rate overrides are NOT included. They are manager-only in '
      + 'WILSON, and this file is readable by everyone who can open the project.',

    project: projectSettings(project),

    // The tree, so a folder is self-describing: someone looking at
    // SCENES/Wlsn-Sc001 can tell what it is without opening WILSON.
    folders,

    // Who is on the project and what they are called on it. project_title is
    // the per-project JOB TITLE ("Lead Animator"); project_role is the
    // permission seat. Both are already readable by any project member.
    team: (bundle.teamAssignments || []).map(m => ({
      member_id:     m.member_id ?? m.user_id ?? null,
      project_role:  m.project_role || null,
      project_title: m.project_title || '',
    })),

    // A cheap integrity signal for a handoff: if the folder has forty scene
    // directories and this says three, the folder travelled and the database
    // did not.
    counts: {
      assets:      (bundle.assets      || []).length,
      scenes:      (bundle.scenes      || []).length,
      shots:       (bundle.shots       || []).length,
      levels:      (bundle.levels      || []).length,
      experiences: (bundle.experiences || []).length,
      phases:      (bundle.phases      || []).length,
      tasks:       (bundle.tasks       || []).length,
    },
  }
}

/** The manifest as the bytes that get written. Two-space indent: a person reads this. */
export function serializeProjectManifest(manifest) {
  return JSON.stringify(manifest, null, 2)
}
