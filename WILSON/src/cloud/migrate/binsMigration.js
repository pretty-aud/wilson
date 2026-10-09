// =============================================================================
// binsMigration.js — a desktop project's bins move with it (BC3, Audrey's B9).
//
// "Bins move with the project": a desktop project moving to the cloud brings
// its bins, logging, flags and takes; its footage locations are named once;
// pictures upload only if B4 allows.
//
// The signed-out desktop keeps a clip as an absolute `source_path`
// (\\nas\footage\Day01\A001_C001.mov, D:\Footage\Day01\…) and records every
// folder a person picked or dropped from as a known root (`binRoots`). The
// cloud (0091) keeps a clip as a footage LOCATION — the company's share,
// saved once by its network address and named — plus a path inside it,
// forward slashes, the same on every computer. So the migration asks, once
// per distinct ROOT, "Which footage location is this?": an existing one of
// the company (matched by network address), or a new one named now. A root
// that is a drive letter or a local folder can only be named by the person
// (the cloud refuses a drive letter as an address, B2), so its question asks
// for the folder's network address; a root the person leaves unanswered
// leaves its clips on this computer, LISTED in the report, never dropped —
// the desktop's bundle is never modified, and a second run after naming the
// root brings them.
//
// Everything here is pure (no network, no React) so binsMigration.test.js
// can pin every rule; runMigration.js does the writes.
// =============================================================================

import { isUncPath, normalizeUncInput, suggestLocationName } from '../../tools/rabbit_v0.1.0/bins/binLocations'
import { toIsoDate } from '../../tools/rabbit_v0.1.0/dates'

// ── Paths ───────────────────────────────────────────────────────────────────

/** A Windows path's key: backslashes, no trailing one, lower-cased. */
export function pathKey(p) {
  let s = String(p ?? '').trim().replace(/\//g, '\\')
  while (s.length > 1 && s.endsWith('\\') && !/^[A-Za-z]:\\$/.test(s)) s = s.slice(0, -1)
  return s.toLowerCase()
}

// A path as segments, the original spelling kept (a drive root `D:\` is
// one segment, `D:`; a network path's two leading backslashes are two empty
// segments, so the host and the share line up with the base's).
function segmentsOf(p) {
  const s = String(p ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '')
  return s === '' ? [] : s.split('\\')
}
const sameSegment = (a, b) => a.toLowerCase() === b.toLowerCase()

/**
 * Is `child` the same folder as `base`, or inside it? Compared segment by
 * segment, case-blind (review round 1: a prefix of the lower-cased string
 * misreads a letter whose lower case is two code units, such as İ).
 */
export function isUnder(child, base) {
  const c = segmentsOf(child)
  const b = segmentsOf(base)
  if (!c.length || !b.length || c.length < b.length) return false
  return b.every((seg, i) => sameSegment(seg, c[i]))
}

/**
 * `child`'s path inside `base`, in 0091's shape (forward slashes, no leading
 * or trailing slash), the child's own spelling kept: '' for the folder
 * itself; null when not inside.
 */
export function relativeUnder(child, base) {
  if (!isUnder(child, base)) return null
  return segmentsOf(child).slice(segmentsOf(base).length).filter(Boolean).join('/')
}

/** How deep a path is (its segments): the measure of "the longest root". */
const depthOf = (p) => segmentsOf(p).length

/** 0091's relative_path shape, as the CHECK admits it. */
export function isCloudRelativePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 1024) return false
  if (/(^\/|\/$|\/\/|\\|:)/.test(rel)) return false
  if (/(^|\/)\.\.?(\/|$)/.test(rel)) return false
  if (/[. ](\/|$)/.test(rel)) return false
  return true
}

/** The share of a network path, \\server\share, when it is one 0091 admits. */
export function shareRootOf(p) {
  const m = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(String(p ?? '').trim().replace(/\//g, '\\'))
  if (!m) return null
  const root = `\\\\${m[1]}\\${m[2]}`
  return isUncPath(root) ? root : null
}

/** 'unc' for a network path, 'local' for a drive letter or anything else. */
export function rootKind(p) {
  return /^\\\\[^\\/]+[\\/]/.test(String(p ?? '').trim().replace(/\//g, '\\')) ? 'unc' : 'local'
}

/** The folder of a path (its parent), or null for a root. */
function folderOf(p) {
  const s = String(p ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '')
  const i = s.lastIndexOf('\\')
  if (i < 0) return null
  const head = s.slice(0, i)
  if (/^[A-Za-z]:$/.test(head)) return `${head}\\`
  if (/^\\\\[^\\]+$/.test(head) || head === '\\') return null
  return head || null
}

// ── Roots ───────────────────────────────────────────────────────────────────

/**
 * The root a clip belongs to: the LONGEST recorded root containing it; else,
 * for a network path, its share; else its own folder. A frame sequence's
 * `source_path` names its folder and is read like a file's — and a sequence
 * folder that was picked as a root ITSELF (the desktop records a picked
 * folder as the root) belongs to the folder above it, so that it has a path
 * inside its location (review round 1: the location itself is no path).
 */
export function rootOfClip(clip, roots) {
  const p = clip?.source_path
  if (typeof p !== 'string' || !p.trim()) return null
  let best = null
  for (const r of roots || []) {
    const rp = r?.path
    if (!rp || !isUnder(p, rp)) continue
    if (!best || depthOf(rp) > depthOf(best)) best = rp
  }
  if (best && pathKey(best) === pathKey(p)) best = folderOf(best) || best
  if (best) return best
  return shareRootOf(p) || folderOf(p)
}

/**
 * The distinct roots of a bundle's clips, each with its kind and its clips:
 * `[{ root, key, kind, clipIds, count }]`, in root order. A clip with no
 * readable path is left out here and reported by the runner.
 */
export function binRootsOf(bundle) {
  const byKey = new Map()
  for (const clip of bundle?.binFiles ?? []) {
    const root = rootOfClip(clip, bundle?.binRoots)
    if (!root) continue
    const key = pathKey(root)
    if (!byKey.has(key)) byKey.set(key, { root, key, kind: rootKind(root), clipIds: [], count: 0 })
    const e = byKey.get(key)
    e.clipIds.push(clip.id)
    e.count++
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The roots of several bundles, merged by key with the projects each serves:
 * `[{ root, key, kind, count, projects: [projectId…] }]`.
 */
export function mergeRoots(perProject) {
  const byKey = new Map()
  for (const { projectId, roots } of perProject || []) {
    for (const r of roots || []) {
      if (!byKey.has(r.key)) byKey.set(r.key, { root: r.root, key: r.key, kind: r.kind, count: 0, projects: [] })
      const e = byKey.get(r.key)
      e.count += r.count
      if (!e.projects.includes(projectId)) e.projects.push(projectId)
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ── The question, in the panel's own words (Help quotes them from here, a
// pure module: the panel's imports build the Supabase client, which CI has
// no address for) ───────────────────────────────────────────────────────────
export const LOCATION_QUESTION = 'Which footage location is this?'
export const LEAVE_FOR_NOW = 'Leave on this computer for now'
export const NAME_IT_INSTEAD = 'Name it'
export const MIGRATE_WAITS = 'Name each footage root first, or leave it on this computer for now.'

// ── The question's answer ───────────────────────────────────────────────────

/**
 * What the question offers for a root before anyone types: for a network
 * root, the company's location that already holds it (the longest address
 * the root is under), else its share, suggested as a new location; for a
 * drive letter or a local folder, nothing — only the person knows the
 * folder's network address.
 */
export function suggestedAnswer(root, existing) {
  const held = holdingLocation(root.kind === 'unc' ? root.root : null, existing)
  // A company location the root is already under: an answer the company
  // gave. A share nobody has named is only a SUGGESTION (review round 1,
  // security): a new company location is made from an address the person
  // confirmed, never from a path a project file carried — so it waits for
  // "Use this address", or for the person to type.
  if (held) return { unc_path: held.unc_path, name: held.name, confirmed: true }
  if (root.kind === 'unc') {
    const share = shareRootOf(root.root)
    return share ? { unc_path: share, name: suggestLocationName(share), confirmed: false } : { unc_path: '', name: '', confirmed: false }
  }
  return { unc_path: '', name: '', confirmed: false }
}

/**
 * The answers the run may act on: a root left for now, or an address the
 * person confirmed (typed, or "Use this address"). A suggestion nobody
 * touched is no answer.
 */
export function confirmedAnswers(answers) {
  const out = {}
  for (const [key, a] of Object.entries(answers || {})) {
    if (!a) continue
    if (a.skip || a.confirmed !== false) out[key] = a
  }
  return out
}

/** The company location whose address holds `anchor` (the longest), or null. */
export function holdingLocation(anchor, existing) {
  if (!anchor) return null
  let best = null
  for (const l of existing || []) {
    if (!l?.unc_path || !isUnder(anchor, l.unc_path)) continue
    if (!best || depthOf(l.unc_path) > depthOf(best.unc_path)) best = l
  }
  return best
}

const ROOT_NOT_INSIDE = (root, unc) => `${root} is not inside ${unc}: name the share, or a folder above these clips.`
// The cloud's own refusal (supabaseAdapter's BINS_REFUSALS.locationShape,
// word for word; binsMigration.test.js pins the two equal — this module
// imports no adapter, so the dry run's helpers load with no Supabase client).
export const ADDRESS_NEEDED = 'A footage location is written as its network address, like \\\\server\\footage — never a drive letter, never this computer (localhost), never an administrative share like C$, never with .. in it, and without a trailing backslash.'

/**
 * One root's answer, resolved:
 *   { kind: 'skip' }                                   — left on this computer
 *   { kind: 'unanswered' }                             — nothing typed yet
 *   { kind: 'invalid', problem }                       — not an address 0091 takes, or the root is not inside it
 *   { kind: 'existing', location, prefix }             — a company location holds it
 *   { kind: 'new', unc_path, name, prefix }            — a location to make now
 * `prefix` is the root's path inside the location ('' when the root is the
 * location itself); a clip's cloud path is prefix + its path inside the root.
 * For a network root the typed address must hold the root; for a local root
 * the typed address IS the root's address on the network.
 */
export function resolveRootAnswer(root, answer, existing) {
  if (answer?.skip) return { kind: 'skip' }
  const typed = normalizeUncInput(answer?.unc_path ?? '')
  if (!typed) return { kind: 'unanswered' }
  if (!isUncPath(typed)) return { kind: 'invalid', problem: ADDRESS_NEEDED }
  const anchor = root.kind === 'unc' ? root.root : typed
  if (root.kind === 'unc' && !isUnder(root.root, typed)) return { kind: 'invalid', problem: ROOT_NOT_INSIDE(root.root, typed) }
  // The location the person NAMED, when the address is one of the company's;
  // else the one whose address holds the root (the longest).
  const named = (existing || []).find(l => l?.unc_path && pathKey(l.unc_path) === pathKey(typed)) || null
  const held = named || holdingLocation(anchor, existing)
  if (held) return { kind: 'existing', location: held, prefix: relativeUnder(anchor, held.unc_path) }
  const name = String(answer?.name ?? '').trim() || suggestLocationName(typed)
  return { kind: 'new', unc_path: typed, name, prefix: relativeUnder(anchor, typed) }
}

// ── The cloud row ───────────────────────────────────────────────────────────

// What the desktop keeps on a clip row that the cloud does not: the absolute
// path (a location + a relative path now), the reading computer's `online`,
// the desktop's bin-root bookkeeping if any rode along, its own stamp
// (`created_at`; the cloud's is `added_at`), the audio columns 0091 has no
// place for (`sample_rate`, `channels`: docs/OUTSTANDING.md), and who added
// it — the cloud stamps `added_by` from the sign-in, never from a file on
// disk (review round 1, security).
const DESKTOP_ONLY = new Set(['source_path', 'online', 'root_id', 'created_at', 'sample_rate', 'channels', 'added_by'])

/**
 * A clip row in the cloud's shape, for a root resolved to a location:
 * `{ row }` or `{ error }`. Ids are kept (0091's are the desktop's UUIDs);
 * the project is the one being migrated (never the row's own claim); the
 * date goes through dates.js; the picture's key is left empty (a poster
 * uploads only while the switch is on, and only the runner knows).
 */
export function cloudBinFileRow(clip, { root, locationId, prefix, workspaceId, projectId }) {
  const inside = relativeUnder(clip?.source_path, root)
  if (inside == null) return { error: `${clip?.original_name || clip?.id}: not inside ${root}` }
  const relative_path = [prefix, inside].filter(Boolean).join('/')
  if (!isCloudRelativePath(relative_path)) return { error: `${clip?.original_name || clip?.id}: its path inside the location is not one the cloud takes (${relative_path || 'the location itself'})` }
  const row = {}
  for (const [k, v] of Object.entries(clip)) if (!DESKTOP_ONLY.has(k)) row[k] = v
  row.project_id = projectId
  row.location_id = locationId
  row.relative_path = relative_path
  row.workspace_id = workspaceId
  row.poster_path = null
  if ('shoot_day' in row) row.shoot_day = toIsoDate(row.shoot_day)
  if (!row.display_name || !String(row.display_name).trim()) row.display_name = clip.original_name || relative_path.split('/').pop()
  return { row }
}

/** Bins ordered parents before children (a child never meets a missing parent); an orphan's parent is cleared so it still arrives, at the top. */
export function binsParentsFirst(bins) {
  const rows = (bins || []).map(b => ({ ...b }))
  const have = new Set(rows.map(b => b.id))
  for (const b of rows) if (b.parent_bin_id && !have.has(b.parent_bin_id)) b.parent_bin_id = null
  const out = []
  const placed = new Set()
  let pending = rows
  while (pending.length) {
    const next = pending.filter(b => !b.parent_bin_id || placed.has(b.parent_bin_id))
    if (!next.length) { // a cycle on disk: break it at the first, which arrives at the top
      pending[0].parent_bin_id = null
      continue
    }
    for (const b of next) { out.push(b); placed.add(b.id) }
    pending = pending.filter(b => !placed.has(b.id))
  }
  return out
}

/** The media a poster can be made of (the desktop's route answers none for the rest). */
export const POSTER_MEDIA = new Set(['video', 'still', 'sequence', 'vfx', 'graphic'])

/**
 * A desktop row of any other table, for the cloud: the project is the one
 * being migrated, and nothing says who made it — the cloud stamps
 * `created_by` / `updated_by` from the sign-in (review round 1, security:
 * a project file is a file on disk). A scene's or shot's `thumbnail_image`
 * is a path on this computer's disk on the desktop: not a thing to send
 * (and not a picture the cloud could show).
 */
export function cloudRowOf(row, projectId) {
  const out = { ...row, project_id: projectId }
  delete out.created_by
  delete out.updated_by
  if ('thumbnail_image' in out) out.thumbnail_image = null
  return out
}

/**
 * The takes a project can land, by shot: a take whose shot or clip did not
 * land is left out (the caller says why); within a shot, exactly one primary
 * (the first flagged, else the first by position) and positions 0..n-1 —
 * 0091's invariant, which only its RPCs keep and a plain insert does not
 * (review round 1).
 */
export function takesToLand(shotTakes, landedShots, landedClips) {
  const byShot = new Map()
  for (const t of shotTakes || []) {
    if (!t || !landedShots.has(t.shot_id) || !landedClips.has(t.bin_file_id)) continue
    if (!byShot.has(t.shot_id)) byShot.set(t.shot_id, [])
    byShot.get(t.shot_id).push({ ...t })
  }
  const out = []
  for (const list of byShot.values()) {
    list.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const primary = list.find(t => t.role === 'primary') || list[0]
    list.forEach((t, i) => {
      t.position = i
      t.role = t === primary ? 'primary' : (t.role === 'primary' || !['part', 'alt'].includes(t.role) ? 'alt' : t.role)
      out.push(t)
    })
  }
  return out
}
