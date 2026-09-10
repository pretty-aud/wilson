// ============================================================
// RABBIT — shot takes: pure selectors (milestone 2)
// ============================================================
//
// A shot take (`bundle.shotTakes`, docs/BINS_DESIGN.md §4.4) links one shot
// to one bin file, many-to-many both ways, ordered by `position`, with a role:
// `primary` (the take the shot is cut from — exactly one per shot that has
// any), `part` (one piece of a shot rebuilt from several takes) or `alt` (a
// spare). Everything the scenes table, the shot popup, the pickers and the
// bin inspector compute from those rows lives here, without React, so
// shotTakeSelectors.test.js can pin it.
//
// The provider's state can hold ORPHANS — a take whose shot was deleted or
// whose file was removed (undo brings either back, so nothing prunes them).
// Every selector here joins through the live shot or file and skips the rest.

export const TAKE_ROLES = ['primary', 'part', 'alt']

export const TAKE_ROLE_META = {
  primary: { label: 'Primary', short: 'PRI', color: '#fb923c', help: 'The take the shot is cut from. One per shot.' },
  part:    { label: 'Part',    short: 'PART', color: '#a78bfa', help: 'One piece of a shot rebuilt from several takes.' },
  alt:     { label: 'Alt',     short: 'ALT', color: '#a8a29e', help: 'A spare, kept for review; not in the cut.' },
}

const byPosition = (a, b) =>
  (Number(a.position) || 0) - (Number(b.position) || 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''))

/**
 * Map shotId → [{ take, file }] in position order. A take whose file is gone
 * is skipped; the shot's existence is the caller's business (it is iterating
 * shots already).
 *
 * Presented the way the server presents a read (rabbitBins.cjs
 * `presentTakes`): positions renumbered 0..n-1 and exactly one primary — the
 * first flagged, else the first — so that while a file removal is still
 * optimistic (its take rows are orphans in state until the next response)
 * the chips, the panel's summary and the star buttons agree. The take
 * objects are copies when a field differs; state is never mutated.
 */
export function takesByShot(shotTakes, binFiles) {
  const files = new Map((binFiles || []).map(f => [f.id, f]))
  const out = new Map()
  for (const take of (shotTakes || []).slice().sort(byPosition)) {
    const file = files.get(take.bin_file_id)
    if (!file) continue
    if (!out.has(take.shot_id)) out.set(take.shot_id, [])
    out.get(take.shot_id).push({ take, file })
  }
  for (const list of out.values()) {
    const primary = list.find(e => e.take.role === 'primary') || list[0]
    list.forEach((e, i) => {
      const role = e.take.id === primary.take.id ? 'primary' : (e.take.role === 'primary' || !TAKE_ROLES.includes(e.take.role) ? 'alt' : e.take.role)
      if (e.take.position !== i || e.take.role !== role) e.take = { ...e.take, position: i, role }
    })
  }
  return out
}

/** The primary entry of a shot's list: the one flagged primary, else the first. */
export function primaryOf(entries) {
  if (!entries?.length) return null
  return entries.find(e => e.take.role === 'primary') || entries[0]
}

export function takesSummary(entries) {
  const list = entries || []
  return {
    count: list.length,
    primary: primaryOf(list),
    parts: list.filter(e => e.take.role === 'part').length,
    alts: list.filter(e => e.take.role === 'alt').length,
  }
}

/** Map fileId → [{ take, shot, scene }] — where a bin file is used, in scene / shot order. */
export function usageByFile(shotTakes, shots, scenes) {
  const shotsById = new Map((shots || []).map(s => [s.id, s]))
  const scenesById = new Map((scenes || []).map(s => [s.id, s]))
  const out = new Map()
  for (const take of shotTakes || []) {
    const shot = shotsById.get(take.shot_id)
    if (!shot) continue
    if (!out.has(take.bin_file_id)) out.set(take.bin_file_id, [])
    out.get(take.bin_file_id).push({ take, shot, scene: shot.scene_id ? scenesById.get(shot.scene_id) || null : null })
  }
  const order = (a, b) => (a.scene?.scene_number ?? 9999) - (b.scene?.scene_number ?? 9999) || (a.shot.shot_number ?? 0) - (b.shot.shot_number ?? 0)
  for (const list of out.values()) list.sort(order)
  return out
}

/** How many shots each file is used in, as a Map fileId → n. */
export function usageCounts(shotTakes, shots) {
  const live = new Set((shots || []).map(s => s.id))
  const out = new Map()
  for (const t of shotTakes || []) {
    if (!live.has(t.shot_id)) continue
    out.set(t.bin_file_id, (out.get(t.bin_file_id) || 0) + 1)
  }
  return out
}

/**
 * Shots a take may be assigned to (Q6: any shot not marked omitted), grouped
 * by scene in scene order — the preferred scene first — with shots that have
 * no scene last. `hiddenOmitted` says how many were left out, so the picker
 * can say so rather than look incomplete.
 */
export function assignableShotGroups(shots, scenes, { preferSceneId = null } = {}) {
  const scenesById = new Map((scenes || []).map(s => [s.id, s]))
  const buckets = new Map()
  let hiddenOmitted = 0
  for (const shot of shots || []) {
    if (shot.status === 'omitted') { hiddenOmitted++; continue }
    const key = shot.scene_id && scenesById.has(shot.scene_id) ? shot.scene_id : '__unlinked__'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(shot)
  }
  const groups = [...buckets.entries()].map(([key, list]) => ({
    key,
    scene: key === '__unlinked__' ? null : scenesById.get(key),
    shots: list.slice().sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0) || String(a.name || '').localeCompare(String(b.name || ''))),
  }))
  groups.sort((a, b) => {
    if (preferSceneId && a.key === preferSceneId) return -1
    if (preferSceneId && b.key === preferSceneId) return 1
    if (!a.scene) return 1
    if (!b.scene) return -1
    return (a.scene.scene_number ?? 9999) - (b.scene.scene_number ?? 9999)
  })
  return { groups, hiddenOmitted }
}

/** The scene most of the given files are logged to, or null. */
export function commonSceneId(files) {
  const counts = new Map()
  for (const f of files || []) if (f.scene_id) counts.set(f.scene_id, (counts.get(f.scene_id) || 0) + 1)
  let best = null; let n = 0
  for (const [id, c] of counts) if (c > n) { best = id; n = c }
  return best
}

export function matchesShotSearch(shot, scene, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  const hay = [shot.name, shot.description, shot.shot_number != null ? `#${shot.shot_number}` : '', shot.shot_number, scene?.name, scene?.scene_number != null ? `sc${scene.scene_number}` : '', shot.framing, shot.status]
    .filter(v => v != null && v !== '').join(' | ').toLowerCase()
  return s.split(/\s+/).every(term => hay.includes(term))
}

/**
 * Files ranked for a shot's picker: tier 0 = logged with this shot as its
 * intended setup, tier 1 = logged to the same scene, tier 2 = everything else.
 * Stable within a tier (the caller's own order). Rejected takes sink to the
 * bottom of their tier; selects and circled takes rise.
 */
export function rankFilesForShot(files, shot) {
  const tierOf = (f) => (shot && f.shot_id && f.shot_id === shot.id) ? 0 : (shot?.scene_id && f.scene_id === shot.scene_id) ? 1 : 2
  const markOf = (f) => (f.review_flag === 'reject' ? 2 : (f.review_flag === 'select' || f.circled) ? 0 : 1)
  return (files || []).map((file, i) => ({ file, tier: tierOf(file), i }))
    .sort((a, b) => a.tier - b.tier || markOf(a.file) - markOf(b.file) || a.i - b.i)
    .map(({ file, tier }) => ({ file, tier }))
}

export const TIER_LABELS = ['Logged for this shot', 'Same scene', 'Everything else']

/**
 * A take's length in frames at the project's fps: a sequence's frame count,
 * otherwise its duration; null when nothing is known (a still, an unprobed
 * clip). "Use take length" offers this for the shot's frame_count (Q6: never
 * written without a click).
 */
export function takeLengthFrames(file, fps) {
  if (!file) return null
  if (file.is_sequence && Number(file.frame_count) > 0) return Math.round(Number(file.frame_count))
  const d = Number(file.duration_sec)
  const f = Number(fps) > 0 ? Number(fps) : 24
  if (Number.isFinite(d) && d > 0) return Math.max(1, Math.round(d * f))
  return null
}
