// =============================================================================
// projectFolders.cjs — "where is this project's folder on this computer",
// answered once (F9; the desktop-build review's A1).
//
// Two resolvers in main.cjs answered it, and differed: resolveProjectFolder
// needed the folder to exist and joined the stored slug as it was;
// resolveProjectFolderRoot did not, and re-slugified it (S40). Since F3 every
// bundle is reconciled on each load and write (folder_slug slugified, never
// empty), so the two computed the same slug on every bundle a caller holds:
// the one real difference is whether the folder must already exist. The
// project's slug, and an asset's, were retyped beside them with three
// fallbacks ('Untitled-Project', 'Untitled', 'Untitled-Asset').
//
//   projectSlugOf(project)   the project folder's one path segment; never empty
//   assetSlugOf(asset)       an asset folder's one segment under ASSETS/; never empty
//   projectFolderOf(bundle, { mustExist })
//     · the personal space has no project folder: null;
//     · a stored folder_root, where it exists and could have been chosen here
//       (storedRootUsable: inside the open demo folder, or anywhere when none
//       is open — review round 2, H3);
//     · else <the configured root>/<projectSlugOf> (Session 34: the demo
//       folder, the workspace drive, the machine's default, in that order —
//       resolveConfiguredRootDir), and, with `mustExist`, only if it is there.
//
// 🚨 NEVER EMPTY, AND THAT IS A FIX (OUTSTANDING F9-02). A title with no
// letter or digit fileSlugify keeps (東京, 🎬) slugified to '' and
// path.join(root, '') is the configured root ITSELF: the project create route
// stored folder_root = the root and made bare _DATABASES and _FILES there, and
// both resolvers answered the root for a bundle whose slug was null or ''
// (an in-flight PATCH's, a pre-slug bundle's) — one project's folder being
// every project's. projectSlugOf ends in 'Untitled-Project-<the id's first
// eight>' (review round 1: one shared 'Untitled-Project' would have been every
// such project's folder in turn). A CJK-named asset the same: its folder was
// ASSETS itself, so deleting it moved the whole ASSETS folder to .trash;
// assetSlugOf ends in 'Untitled-Asset-<the id's first eight>'.
//
// Pure: every host dependency is injected, and projectFolders.test.js runs it
// for real on a temp root. main.cjs keeps both resolver names as one-line
// bindings (the copy fence, legalFiling and five lifted tests ask for them by
// name); their callers did not change.
// =============================================================================
'use strict';

const PROJECT_FALLBACK = 'Untitled-Project';
const ASSET_FALLBACK = 'Untitled-Asset';

function createProjectFolders({ fs, path, fileSlugify, isPersonalBundle, storedRootUsable, resolveConfiguredRootDir }) {
  for (const [name, fn] of Object.entries({ fileSlugify, isPersonalBundle, storedRootUsable, resolveConfiguredRootDir })) {
    if (typeof fn !== 'function') throw new Error(`createProjectFolders: ${name} is required`);
  }
  if (!fs || !path) throw new Error('createProjectFolders: fs and path are required');

  // main.cjs's fileSlugify throws on a non-string (a number in a body).
  const slug = (value) => fileSlugify(String(value ?? ''));
  // F9 review round 1: the fallback names the ROW, so two projects (or two
  // assets) whose names slug to nothing never share one folder — a rename of
  // one moved the other's files, a delete trashed them. Already in
  // fileSlugify's form, so the reconcile keeps a stored one as it is.
  const fallback = (base, id) => {
    const tag = String(id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    return tag ? fileSlugify(`${base} ${tag}`) : fileSlugify(base);
  };
  // A stored asset slug is one plain path segment, or it is not used: '.'
  // resolved to ASSETS itself (and its delete trashed every asset's folder).
  const plainSegment = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !/[\\/:\0]/.test(s);

  /** The project folder's one path segment, never empty. */
  function projectSlugOf(project) {
    return slug(project?.folder_slug) || slug(project?.title) || fallback(PROJECT_FALLBACK, project?.id);
  }

  /** An asset folder's segment under ASSETS/, never empty. A stored slug that
   *  is one plain segment is taken as it is: the import route stores a
   *  folder's own name, and every caller contains the join
   *  (resolveContainedFilePath). */
  function assetSlugOf(asset) {
    const stored = asset?.folder_slug;
    if (plainSegment(stored)) return stored;
    return slug(asset?.name) || fallback(ASSET_FALLBACK, asset?.id);
  }

  /** The project's folder on this computer, or null. */
  function projectFolderOf(bundle, { mustExist } = {}) {
    if (typeof mustExist !== 'boolean') throw new Error('projectFolderOf: say whether the folder must exist ({ mustExist })');
    if (isPersonalBundle(bundle)) return null; // MO1: no project folder, no _DATABASES mirror
    const stored = bundle?.project?.folder_root;
    if (stored && fs.existsSync(stored) && storedRootUsable(stored)) return stored;
    const rootBase = resolveConfiguredRootDir();
    if (!rootBase) return null;
    const folder = path.join(rootBase, projectSlugOf(bundle?.project));
    if (!mustExist) return folder;
    return fs.existsSync(folder) ? folder : null;
  }

  return { projectSlugOf, assetSlugOf, projectFolderOf };
}

module.exports = { createProjectFolders, PROJECT_FALLBACK, ASSET_FALLBACK };
