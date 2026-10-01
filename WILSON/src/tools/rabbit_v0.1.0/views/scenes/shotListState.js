// ============================================================
// RABBIT — what the shot-list bar and picker say about a list
// (post-overhaul S3b). Pure: rows in, words and flags out.
// ============================================================

import { buildShotListSnapshot, withdrawnRestoreRefusal } from '../../state/shotListModel'

/**
 * JSON with every object's keys in one order, so two values compare equal
 * whatever order their keys arrived in. A Save's snapshot read back from the
 * cloud is jsonb, which stores keys in its own order (shorter keys first),
 * not the order the client wrote them.
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v === undefined ? null : v)
}

/**
 * Whether a list has changed since its last version point (D5's "Save").
 * 'never'   no Save yet (snapshot still {})
 * 'changed' its scenes, shots or membership differ from what the Save
 *           recorded — rebuilt with shotListModel's own buildShotListSnapshot,
 *           the function the Save itself ran, over every row
 * 'saved'   as saved; `at` is the Save's saved_at
 * A rename, a new version number or a new summary is not a change here: a
 * Save records the list's content, and the bar names the list anyway.
 */
export function listSaveState({ list, scenes, shots, items }) {
  const snap = list?.snapshot
  if (!snap || typeof snap !== 'object' || !snap.saved_at) return { kind: 'never' }
  const now = buildShotListSnapshot({ list, scenes, shots, items, savedAt: snap.saved_at, savedBy: snap.saved_by ?? null })
  const same = ['scenes', 'shots', 'items'].every(k => canonicalJson(now[k] || []) === canonicalJson(snap[k] || []))
  return { kind: same ? 'saved' : 'changed', at: snap.saved_at }
}

/**
 * Whether this person may put an archived list back, and how:
 *   'archive'   a project manager or a workspace admin (D8): Restore is
 *               archiveShotList(id, false), for any archived list
 *   'withdrawn' the maker of a list they withdrew, while it is not Saved
 *               (0086): restoreWithdrawn — shotListModel's own rule, with
 *               the provider's notion of the user (the signed-in one on a
 *               backend with users; none on the Local Server, where the
 *               maker test is skipped as D8's roles are)
 *   null        neither: no Restore is offered
 */
export function restoreRouteFor({ list, canActivate, canWrite, makerUserId }) {
  if (!list?.archived_at) return null
  if (canActivate) return 'archive'
  if (canWrite && withdrawnRestoreRefusal({ row: list, kind: 'shot_list', userId: makerUserId }) === null) return 'withdrawn'
  return null
}
