// =============================================================================
// shotRefiling.js — post-overhaul S4c: the one-time move of a project's shot
// folders into their scenes' folders, the PURE half.
//
// Audrey, 2026-10-05: "shot folders should be in the scene folders so when i
// press a scene i should see the shot folders in the scene folder. since
// inheritably shots have to be a part of a scene." From S4c a new shot's
// folder is SCENES/<scene>/<shot> (folderPaths.entityFolderPath). Every
// project that exists today has its shot folders under SHOTS/, and nothing
// moves them by surprise (her rule: these are REAL folders on disk and real
// prefixes in the bucket): the Files tab OFFERS the move to someone who can
// write the project, and each backend runs it — the Supabase adapter's
// refileShotFolders moves the objects in both buckets, verifies each landed,
// then rewrites the rows; the Local Server's POST …/folders/refile-shots
// moves the directory and rewrites the bundle; the dev fixtures rewrite their
// store. One shot folder at a time, idempotent (a second run finds nothing to
// move), resumable (a stop part way leaves rows that still say where every
// file IS), never deleting a file.
//
// This module decides WHAT is pending and WHERE each thing goes, from rows
// alone, so the offer in the explorer, the three backends and the tests all
// read the same rule. electron/main.cjs carries `pendingShotRefilingFor` as
// its own copy (it cannot import the renderer bundle); folderParity.test.js
// pins the two together.
// =============================================================================

import { entityFolderPath, entityFolderSlug } from './folderPaths'

export const SHOTS_PREFIX = 'SHOTS/'

/**
 * The shot folders a project still has under SHOTS whose shot has a scene
 * that exists — the ones the move would take. A folder under SHOTS whose
 * shot is gone, or whose shot has no scene (shots.scene_id is nullable),
 * stays where it is and is not listed: there is nowhere for it to go.
 *
 * @returns {{ folder: object, shot: object, scene: object, sceneFolder: object|null, toPath: string }[]}
 *   in folder-path order, `sceneFolder` the scene's existing row when it has
 *   one, `toPath` the path the shot folder will have — exactly what the
 *   backends write: the scene's PLANNED path (each backend ensures the
 *   scene's row first, which renames a row that lags its scene's name to
 *   the planned slug under SCENES) and the shot folder's OWN slug (the move
 *   re-parents the folder; it never renames it, so a folder whose slug lags
 *   its shot's name keeps it). Review round 2, item 11.
 */
export function pendingShotRefiling({ folders = [], shots = [], scenes = [] } = {}) {
  const shotById = new Map((shots || []).filter(Boolean).map(s => [String(s.id), s]))
  const sceneById = new Map((scenes || []).filter(Boolean).map(s => [String(s.id), s]))
  const out = []
  for (const folder of folders || []) {
    if (!folder || !folder.shot_id || typeof folder.path !== 'string') continue
    if (!folder.path.startsWith(SHOTS_PREFIX)) continue
    const shot = shotById.get(String(folder.shot_id))
    if (!shot || !shot.scene_id) continue
    const scene = sceneById.get(String(shot.scene_id))
    if (!scene) continue
    const sceneFolder = (folders || []).find(f => f && f.scene_id && String(f.scene_id) === String(scene.id)) || null
    const toPath = `${entityFolderPath('scene', scene)}/${folder.slug || entityFolderSlug('shot', shot)}`
    out.push({ folder, shot, scene, sceneFolder, toPath })
  }
  return out.sort((a, b) => String(a.folder.path).localeCompare(String(b.folder.path)))
}

/** The SHOTS category row, if the project still has one. */
export function shotsCategoryRow(folders = []) {
  return (folders || []).find(f => f && f.kind === 'category' && f.path === 'SHOTS') || null
}

/** True when no folder row sits under SHOTS/ any more (the category may go). */
export function shotsCategoryEmpty(folders = []) {
  return !(folders || []).some(f => f && typeof f.path === 'string' && f.path.startsWith(SHOTS_PREFIX))
}

/**
 * Where a shot's objects live in the bucket: inside its scene's prefix since
 * S4c — projects/<pid>/scenes/<sceneId>/<shotId> — or, with no scene, the
 * prefix every shot had before, projects/<pid>/shots/<shotId>. Ids, not
 * slugs: a bucket prefix never has to follow a rename (the folder ROW does;
 * folderPaths.js explains why the two are different). The third segment is
 * `scenes`, which rabbit_money_segment (0042, 0088) does not lock, so the
 * money gate, the quota exemption and the thumbnail policies are untouched:
 * every one of them reads segments one to three of the key and no more.
 */
export function shotObjectPrefix(projectId, sceneId, shotId) {
  return sceneId
    ? `projects/${projectId}/scenes/${sceneId}/${shotId}`
    : `projects/${projectId}/shots/${shotId}`
}

/** The old key shape, projects/<pid>/shots/<shotId>/<leaf…>, for THIS shot. */
export function isLegacyShotKey(key, { projectId, shotId }) {
  return typeof key === 'string' && key.startsWith(`projects/${projectId}/shots/${shotId}/`)
}

/**
 * The key an object moves to: the same leaf under the nested prefix. Null
 * for a key that is not this shot's legacy key (already moved, or a body in
 * another store's shape) — the caller leaves such a row alone.
 */
export function nestedShotKey(key, { projectId, sceneId, shotId }) {
  if (!isLegacyShotKey(key, { projectId, shotId })) return null
  const rest = key.slice(`projects/${projectId}/shots/${shotId}/`.length)
  if (!rest) return null
  return `${shotObjectPrefix(projectId, sceneId, shotId)}/${rest}`
}

/**
 * The words the Files tab shows for the offer: how many, and which. Names
 * are the folders' own (their slugs), three at most, then "and N more".
 */
export function refilingSentence(pending = []) {
  const n = pending.length
  if (n === 0) return ''
  const names = pending.map(p => p.folder.slug || entityFolderSlug('shot', p.shot))
  const shown = names.slice(0, 3).join(', ')
  const more = n > 3 ? ` and ${n - 3} more` : ''
  return `${n} shot folder${n === 1 ? '' : 's'} still ${n === 1 ? 'sits' : 'sit'} under SHOTS: ${shown}${more}.`
}
