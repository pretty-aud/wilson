// =============================================================================
// projectDiskPath.js — the renderer's one answer to "where is this project's
// folder on this computer" (F9; the desktop-build review's A1).
//
// FileManager built that path three times (the copy's destination, Download's
// "show in folder", Open folder) and entityFiles.js a fourth, each with the
// same rule retyped and the renderer's own fallback name ('Untitled' where the
// main process says 'Untitled-Project'). This is the rule once:
//
//   the project's stored folder_root, when it has one;
//   else the root this computer resolves under — readFilesConfig()'s
//     effectiveRootDir (S34: the workspace drive when one is pushed), else its
//     defaultRootDir — joined with the project's folder slug
//     (folderPaths.projectFolderSlug, the main process's projectSlugOf for
//     every project the desktop holds: its folder_slug is never empty there);
//   then `rel` (a record's or an entity's folder, relative to the project
//   folder) and `leaf` (a file's stored name);
//
// in Windows separators, the desktop's. It does NOT decide whether the path
// may be written: rabbit:copy-file's fence (electron/copyFileFence.cjs) still
// judges every destination against the project's own roots in the main
// process, and refuses anything else with its own sentence.
// =============================================================================

import { projectFolderSlug } from '../folderPaths'

const toSlashes = (p) => String(p).replace(/\\/g, '/')

/**
 * @param {object} args
 * @param {object} args.project  the project row (folder_root, folder_slug, title)
 * @param {object} [args.api]    the desktop bridge (window.electronAPI.rabbit): readFilesConfig
 * @param {string} [args.rel]    a folder relative to the project folder ('ASSETS/Hero', 'SCENES/Dawn/')
 * @param {string} [args.leaf]   a file's name in that folder
 * @returns {Promise<string|null>} the absolute path, or null when this computer has no root for it
 */
export async function projectDiskPath({ project, api, rel = '', leaf = null } = {}) {
  let base = null
  if (project?.folder_root) {
    base = toSlashes(project.folder_root)
  } else if (typeof api?.readFilesConfig === 'function') {
    const cfg = await api.readFilesConfig()
    const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
    if (rootBase) base = `${toSlashes(rootBase).replace(/\/+$/, '')}/${projectFolderSlug(project)}`
  }
  if (!base) return null
  // The base is kept whole (a UNC root's leading `//` is its server's name);
  // only its trailing separators go, and the parts after it are plain segments.
  const parts = [base.replace(/\/+$/, ''), ...toSlashes(rel || '').split('/').filter(Boolean)]
  if (leaf) parts.push(String(leaf))
  return parts.join('/').replace(/\//g, '\\')
}
