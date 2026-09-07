// ============================================================
// RABBIT — folderPaths
// ============================================================
//
// Session 26. The project folder tree, computed once and used by every
// backend.
//
// Audrey, 2026-08-03: R.A.B.B.I.T. is also a project file manager, and the
// folder tree must reflect in "whichever storage backend the company
// selected" — not local disk only, which is all `fs.mkdirSync` in
// electron/main.cjs can do. Assets are first-class items with their own
// folders; scenes, shots, levels and experiences each get their OWN folder
// (five scenes means five folders under SCENES/, not one shared one).
//
// 🚨 THIS MODULE IS PURE, AND THAT IS THE POINT.
// It computes paths; it never touches a filesystem, a bucket or a database.
// The three adapters each turn the same plan into their own storage:
//
//     local_server   real directories under projects.folder_root
//     supabase       rows in public.folders + path prefixes in rabbit-files
//     google_drive   read-only; it renders the tree, it does not build it
//
// The alternative — each adapter deriving its own paths — is the exact
// mistake entityNaming.js:20-26 exists to prevent for names. The same project
// must produce the same folder whichever backend it is stored in, or
// switching backends silently re-files everything.
//
// WHY `path` IS COMPUTED HERE AND NOT IN POSTGRES. A generated column would
// only exist on one of the two writable backends: Local Server is a JSON
// bundle with no Postgres in it. Same reasoning, same conclusion as S25 made
// for scene and shot names.

import { fileSlugify } from './entityNaming'

/**
 * The top-level buckets inside a project folder.
 *
 * ASSETS / SCENES / SHOTS were designed in long before this session —
 * FileManager.jsx:84 has computed `parentType = sceneId ? 'SCENES' : shotId ?
 * 'SHOTS' : 'ASSETS'` all along, and nothing has ever created the first two.
 * LEVELS and EXPERIENCES are new here; they were not in that switch at all.
 *
 * INVOICES already exists on both backends under exactly this name
 * (electron/main.cjs:1300, supabaseAdapter.js:741) and its case is
 * load-bearing on the Supabase side — migration 0039 matches it with upper().
 * Do not change the spelling of that one.
 *
 * `enabledBy` names the projects column that reveals the category's tab.
 * A category is created when it is enabled, or lazily when its first entity
 * appears — never speculatively, because a film project has no use for a
 * LEVELS folder. 🚨 Turning the toggle back OFF removes NOTHING: that is
 * Audrey's stated requirement and the reason the tree is a table at all.
 */
export const FOLDER_CATEGORIES = [
  { slug: 'ASSETS',      entityType: 'asset',      enabledBy: null },
  { slug: 'SCENES',      entityType: 'scene',      enabledBy: 'scenes_enabled' },
  { slug: 'SHOTS',       entityType: 'shot',       enabledBy: 'scenes_enabled' },
  { slug: 'LEVELS',      entityType: 'level',      enabledBy: 'levels_enabled' },
  { slug: 'EXPERIENCES', entityType: 'experience', enabledBy: 'experiences_enabled' },
  { slug: 'INVOICES',    entityType: 'invoice',    enabledBy: null },
]

/**
 * Which `folders` column carries the link for each entity type.
 *
 * Five nullable FKs rather than a polymorphic (type, id) pair, because a
 * polymorphic id cannot be a foreign key — nothing would stop a folder
 * pointing at a scene that no longer exists. See 0041.
 */
export const ENTITY_FK_COLUMN = {
  asset:      'asset_id',
  scene:      'scene_id',
  shot:       'shot_id',
  level:      'level_id',
  experience: 'experience_id',
}

/** The bundle key each entity type is read from, for whole-tree rebuilds. */
export const ENTITY_BUNDLE_KEY = {
  asset:      'assets',
  scene:      'scenes',
  shot:       'shots',
  level:      'levels',
  experience: 'experiences',
}

const FALLBACK_NAME = {
  asset:      'Untitled-Asset',
  scene:      'Untitled-Scene',
  shot:       'Untitled-Shot',
  level:      'Untitled-Level',
  experience: 'Untitled-Experience',
}

// 🚨 NOT MODELLED IN THE TREE, deliberately:
//
//   <slug>_DATABASES  — on `main` this was never a files folder, it was the
//     DATASTORE: mirrorProjectDatabases wrote project.json, team.json,
//     tasks.json, timeline.json and budget.json into it. Database information
//     lives in Supabase. Porting it would reintroduce a second, diverging
//     copy of every project on disk, which is the one thing the manifest
//     decision (database authoritative, file a MIRROR) exists to prevent.
//     electron/main.cjs still creates it for existing local projects; this
//     session neither extends it nor removes it.
//
//   <slug>_FILES — the local managed-files directory
//     (electron/main.cjs:960). Its name embeds the project slug, so it is the
//     one folder whose path is not backend-neutral. Reconciling it belongs
//     with S27, which is the session that unifies file storage and can
//     therefore price the migration. Leaving it out of the tree is honest;
//     inventing a `FILES` category the disk does not have would not be.

/**
 * 🚨 THE FALLBACK FIRES ON AN EMPTY SLUG, NOT ON A MISSING NAME.
 *
 * Found by folderPaths.test.js, not by reading: `x || 'Untitled-Thing'` — the
 * shape every existing caller uses — is not enough. fileSlugify strips
 * everything that is not alphanumeric, so a name of '..' or '###' is TRUTHY
 * and slugifies to the empty string. That yields a path of 'SCENES/', which
 * has an empty final segment.
 *
 * On Supabase the database catches it (folders_slug_nonempty_chk and
 * folders_path_shape_chk both refuse it) — but as a constraint violation with
 * no explanation, on a write the user thinks is creating a scene. On Local
 * Server there is no constraint at all: it would record a row pointing at the
 * category folder itself.
 *
 * So the guard is on the OUTPUT. electron/main.cjs carries the same guard for
 * the same reason; folderParity.test.js pins the two together.
 */
function slugOrFallback(name, fallback) {
  return fileSlugify(name) || fileSlugify(fallback)
}

/** The project folder's own name. One path segment. */
export function projectFolderSlug(project) {
  return project?.folder_slug || slugOrFallback(project?.title, 'Untitled-Project')
}

/** The category a given entity type's folders live under. */
export function categoryForEntityType(entityType) {
  return FOLDER_CATEGORIES.find(c => c.entityType === entityType) || null
}

/** An entity folder's own name. One path segment, never empty. */
export function entityFolderSlug(entityType, entity) {
  return slugOrFallback(entity?.name, FALLBACK_NAME[entityType] || 'Untitled')
}

/**
 * Paths are RELATIVE to the project folder, so the same string works on every
 * backend: disk resolves it against projects.folder_root, Supabase against
 * projects/<project_id>/ in the rabbit-files bucket. The root's path is ''.
 */
export function entityFolderPath(entityType, entity) {
  const category = categoryForEntityType(entityType)
  if (!category) return null
  return `${category.slug}/${entityFolderSlug(entityType, entity)}`
}

/**
 * The folders a project should have before any entity exists: the root, plus
 * every category that is either unconditional or currently revealed.
 *
 * Returns plain descriptors — `parentPath` rather than `parent_id`, because a
 * plan is computed before any row exists. Each adapter resolves the parent as
 * it writes.
 */
export function planProjectFolders(project) {
  const plan = [{
    kind: 'root',
    entityType: null,
    slug: projectFolderSlug(project),
    label: project?.title || null,
    path: '',
    parentPath: null,
  }]
  for (const category of FOLDER_CATEGORIES) {
    if (category.enabledBy && !project?.[category.enabledBy]) continue
    plan.push({
      kind: 'category',
      entityType: category.entityType,
      slug: category.slug,
      label: null,
      path: category.slug,
      parentPath: '',
    })
  }
  return plan
}

/**
 * One entity's own folder, plus the category it needs to sit in.
 *
 * The category is included because a category is created lazily — a project
 * with scenes_enabled off can still have had scenes created before the toggle
 * was flipped, and the entity folder must not be orphaned.
 *
 * 🚨 RENAME MOVES THE FOLDER — a deliberate decision, recorded here because
 * the table makes the opposite possible and the next reader will wonder.
 *
 * The slug follows the entity's name, which is what electron/main.cjs already
 * does for assets (:1231-1246, renaming the directory and rewriting the
 * ASSETS/<slug>/ prefix on every managed file). Keeping that means all three
 * backends behave identically today and no existing local project changes
 * behaviour. The `label` column is populated anyway, so when S27 puts real
 * files under these paths — at which point "rename" becomes "copy every
 * object" on Supabase — that session can switch to a stable slug with no
 * migration, because the column is already there. Deferring the expensive
 * decision to the session that can price it is the point.
 */
export function planEntityFolder(project, entityType, entity) {
  const category = categoryForEntityType(entityType)
  if (!category) return null
  const slug = entityFolderSlug(entityType, entity)
  return {
    category: {
      kind: 'category',
      entityType: category.entityType,
      slug: category.slug,
      label: null,
      path: category.slug,
      parentPath: '',
    },
    folder: {
      kind: 'entity',
      entityType,
      slug,
      label: entity?.name || null,
      path: `${category.slug}/${slug}`,
      parentPath: category.slug,
      [ENTITY_FK_COLUMN[entityType]]: entity?.id || null,
    },
  }
}

/**
 * The whole tree a loaded project bundle implies — used to reconcile a
 * project whose folders predate this feature, and by the Local Server route
 * that has no incremental hook to attach to.
 */
export function planFullTree(project, bundle = {}) {
  const plan = planProjectFolders(project)
  const seen = new Set(plan.map(f => f.path))
  for (const [entityType, bundleKey] of Object.entries(ENTITY_BUNDLE_KEY)) {
    for (const entity of bundle[bundleKey] || []) {
      const planned = planEntityFolder(project, entityType, entity)
      if (!planned) continue
      if (!seen.has(planned.category.path)) {
        seen.add(planned.category.path)
        plan.push(planned.category)
      }
      // Two entities whose names slugify identically would collide on `path`.
      // The database refuses that (folders_project_path_uniq); dropping the
      // duplicate here means the reconcile writes what it can instead of
      // failing wholesale, and the survivor is the first by bundle order,
      // which is sort_order — stable across runs.
      if (seen.has(planned.folder.path)) continue
      seen.add(planned.folder.path)
      plan.push(planned.folder)
    }
  }
  return plan
}
