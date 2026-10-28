// =============================================================================
// runMigration — single-user → cloud data migration runner.
//
// Reads every RABBIT project from the local_server Express backend
// (/api/rabbit/projects) which serves JSON bundles persisted under
// {userData}/rabbit-data/projects/{id}/project.json. The Session 2 scope
// mentions "IndexedDB"; no RABBIT code uses IndexedDB — that term in the
// original prompt referred to the Express-backed JSON store.
//
// Writes to Supabase via the shared authenticated client, scoped by RLS
// to the target workspace. Tables, in order: projects, phases, milestones
// (M1), assets, tasks, task_dependencies + phase_dependencies (Track A A2 —
// the edges were dropped on the floor before 2026-09-06), comments (M1),
// then — BC3 (Audrey's B9, "bins move with the project") — scenes and
// shots; then — M1, night 3 of docs/sessions/PLAN_TO_1_0.md — shot_lists
// with their shot_list_items and edits (the active list and the archived
// ones through 0084's functions), folders, and files (each filed in its
// folder, so after them); then bins, bin_locations, bin_files, shot_takes,
// a task's items (FX2, 0096), the project's saved views and groupings
// (VW1c, 0098, through the cloud adapter's own INSERTs), and the clips'
// pictures to rabbit-thumbnails while the company's switch is on. Part 2
// (M2, night 4) carries the budgets, expenses, levels, experiences and the
// team. The migration is:
//   - idempotent: already-migrated rows are detected by id and skipped
//   - resumable: a mid-flight failure leaves the cloud in a consistent
//                state; re-running picks up only the missing rows
//   - dry-runnable: { dryRun: true } returns the same report without
//                   performing any writes
//
// The runner accepts an onProgress callback so the UI can stream per-project
// status (useful for large workspaces where a full migration takes minutes).
// =============================================================================

import { supabase } from '../auth/supabaseClient'
// The edge tables' routing rule and column allowlist come from the adapter
// that owns them — one vocabulary, not a restatement (Track A A2, 2026-09-06).
import { DEPENDENCY_TABLE, dependencyKind, toColumns, supabaseAdapter } from '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter'
// VW1c (0098): a view's config read as every screen reads it (never throws).
import { readViewConfig } from '../../tools/rabbit_v0.1.0/state/tableViewsModel'
// B3 (Track B): the desktop loopback API refuses /api without the per-launch
// token; localFetch attaches it (same-origin URLs only).
import { localFetch } from '../../lib/localServerFetch.js'
import { isLegalFile, LEGAL_SEGMENT, LEGAL_UNAVAILABLE } from '../../tools/rabbit_v0.1.0/fileTags'
// BC3 (B9): the bins' part — the roots, the question's answers, the cloud
// row shape — is pure and lives beside this file.
import {
  binRootsOf, mergeRoots, pathKey, resolveRootAnswer, cloudBinFileRow, cloudRowOf, binsParentsFirst, takesToLand, takePairKey, notCarriedOf, notCarriedLabel, notCarriedPart2, POSTER_MEDIA,
} from './binsMigration'
// M1 (night 3): the project row, the five kinds' rows and the orders their
// keys need — pure, beside this file as the bins' part is.
import {
  projectRowForCloud, projectLeftAtHome, milestoneRowForCloud, COMMENT_TARGETS, commentRowForCloud,
  isArchived, shotListRowForCloud, shotListItemRowForCloud, editRowForCloud, listLabel, itemsInListOrder,
  editsParentsFirst, foldersParentsFirst, folderRowForCloud, folderDecision, cloudFolderIndex, desktopFolderOfFile,
} from './migrationRows'

const RABBIT_BASE = '/api/rabbit'
const POSTER_BUCKET = 'rabbit-thumbnails'
const POSTER_MAX_BYTES = 262144 // the bucket's own cap (0053)

// The sentences the bins' part says (the panel and the tests quote them).
export const BINS_LEFT_BEHIND = (n) => `${n} clip${n === 1 ? '' : 's'} left on this computer: name ${n === 1 ? 'its' : 'their'} footage location and run the migration again`
export const POSTERS_SWITCH_OFF = 'pictures stay on this computer: the company has not allowed files to be viewed from outside the office network (a workspace admin can turn that on in App settings, Storage)'
// A take of a shot or clip removed on this computer (the desktop keeps the
// row for undo, and shows it to nobody) is not carried, and not an error
// (review round 2: every such row failed every run, so an ordinary project
// never reached Done).
export const ORPHAN_TAKES = (n) => `${n} take${n === 1 ? '' : 's'} of a shot or clip removed on this computer (kept there for undo) not carried`
// What the migration does not carry, said under the report BEFORE the
// archive is offered (review round 2) — since M1, what part 2 of the
// migration carries apart from what no migration carries (`part2`).
export const NOT_CARRIED_SENTENCE = (list) => {
  const words = (xs) => xs.map(x => `${x.count} ${x.label}`).join(', ')
  const later = list.filter(x => x.part2)
  const never = list.filter(x => !x.part2)
  return [
    later.length ? `Stays on this computer for now (part 2 of the migration carries it): ${words(later)}.` : '',
    never.length ? `Stays on this computer (the migration does not carry it): ${words(never)}.` : '',
    'Archive and clear local keeps a copy in the archive file only.',
  ].filter(Boolean).join(' ')
}
// VW1c (0098): the views' part's sentences (the panel and the tests quote them).
// A view filtering by a level or an experience goes up; the rows its filter
// names do not (levels and experiences are not carried), so it matches nothing.
export const VIEW_FILTERS_LEFT_BEHIND = (n) => `${n} saved view${n === 1 ? '' : 's'} filter${n === 1 ? 's' : ''} by a level or an experience, which the migration does not carry: in the cloud ${n === 1 ? 'that filter matches' : 'those filters match'} nothing`
export const TABLE_VIEWS_NOT_IN_CLOUD = (views, groupings) => `${views} saved view${views === 1 ? '' : 's'} and ${groupings} grouping${groupings === 1 ? '' : 's'} stay on this computer: this cloud does not keep saved views yet (migration 0098) — run the migration again once it does`
export const TABLE_VIEWS_UNREAD = (message) => `could not read the saved views and groupings already in the cloud, so none was written (run the migration again): ${message}`
// The NOT_CARRIED entry for the groupings of levels and experiences (the
// report's words, binsMigration's notCarriedLabel shape).
const LEVEL_GROUPINGS_KEY = 'levelGroupings'
const levelGroupingsLabel = (n) => (n === 1 ? 'grouping of levels or experiences' : 'groupings of levels or experiences')
// M1 (night 3): the project row's and the five kinds' sentences (the panel
// and the tests quote them). A project row's locked and open bid versions
// wait for the budgets, part 2's; its folder on this computer stays this
// computer's (measured: the cloud takes a project folder only from an admin
// or a manager, inside the company's storage drive).
export const BID_VERSIONS_PART_2 = (n) => `${plural(n, 'project')} ${n === 1 ? 'names' : 'name'} a locked or open bid version: part 2 of the migration sets ${n === 1 ? 'it' : 'them'} with the budgets, so the cloud has none yet`
export const PROJECT_FOLDER_STAYS = (n) => `${plural(n, 'project folder')} on this computer ${n === 1 ? 'stays' : 'stay'} this computer's setting: in the cloud a workspace admin or manager sets a project's folder, inside the company's storage drive`
// Review round 1 (M1): a status the cloud's type does not have refused the
// whole project; it is left out, so the cloud's default applies, and said.
export const STATUS_NOT_IN_CLOUD = (n, statuses) => `${plural(n, 'project')} ${n === 1 ? 'has' : 'have'} a status the cloud does not have (${statuses.join(', ')}): ${n === 1 ? 'it arrives' : 'they arrive'} as active`
// Review round 2: a value the cloud's column cannot hold (a number past its
// room, an unreadable date, a person that is no id) is left out; said, in
// the project settings' own words, for a project that arrives.
export const VALUES_NOT_IN_CLOUD = (n, words) => `${plural(n, 'project')} ${n === 1 ? 'has a value' : 'have values'} the cloud cannot hold (${words.join(', ')}): left out, so the field is empty or at the cloud's default`
export const KEY_DATES_PHASE_LET_GO = (n) => `${plural(n, 'key date')} ${n === 1 ? 'arrives' : 'arrive'} without ${n === 1 ? 'its' : 'their'} phase: removed on this computer, in the cloud's trash, or not this project's there`
export const EDITS_CHAIN_TAKEN = (n) => `${plural(n, 'edit')} not carried: the shot list's one chain of edits already has an edit in ${n === 1 ? 'its' : 'their'} place (made in the cloud since, or a second chain an older version kept on this computer), and an edit cannot be moved`
export const FILE_LINKS_LET_GO = (n) => `${plural(n, 'link')} of a file to a row removed on this computer, in the cloud's trash, or not this project's there let go`
export const KEY_DATES_TRASHED = (n) => `${plural(n, 'key date')} in this computer's Recently deleted not carried`
export const COMMENTS_REMOVED = (n) => `${plural(n, 'comment')} marked removed on this computer not carried`
export const COMMENTS_ON_GONE_ROWS = (n) => `${plural(n, 'comment')} on a row removed on this computer, or in the cloud's trash, not carried`
export const ITEMS_ON_GONE_ROWS = (n) => `${plural(n, 'item')} of a shot list on a scene or shot removed on this computer not carried`
export const FOLDERS_OF_GONE_ROWS = (n) => `${plural(n, 'folder')} of a row removed on this computer, or in the cloud's trash, not carried`
export const FOLDERS_TAKEN = (n) => `${plural(n, 'folder')} not carried: the cloud has another row's folder in ${n === 1 ? 'its' : 'their'} place, so ${n === 1 ? 'its' : 'their'} files sit at the project's top there`
export const FILES_PLACED = (n) => `${plural(n, 'file')} filed in ${n === 1 ? 'its folder' : 'their folders'}, as on this computer`
export const ARCHIVED_AGAIN = (labels) => `Archived on this computer, so archived in the cloud once carried: ${labels.join(', ')} (a workspace admin or the project's manager can; anyone else, only a list or edit nobody has saved or built on)`
export const LIVE_IN_CLOUD = (n) => `${n} ${n === 1 ? 'shot list or edit' : 'shot lists or edits'} archived on this computer ${n === 1 ? 'is' : 'are'} live in the cloud: a run archives only what it carries (archive ${n === 1 ? 'it' : 'them'} on the Scenes tab)`
export const SHOT_LIST_NAME_TAKEN = (label) => `a shot list called "${label}" is already in the cloud under another id (made there since), so this one was not carried: rename it on this computer and run again`
export const EDIT_NAME_TAKEN = (label) => `this shot list already has an edit called "${label}" in the cloud (made there since), so this one was not carried: rename it on this computer and run again`

// The panel's line for the lists and edits archived as on this computer.
export const ARCHIVED_IN_CLOUD = (lists, edits, dry) => {
  const what = [lists ? plural(lists, 'shot list') : '', edits ? plural(edits, 'edit') : ''].filter(Boolean).join(' and ')
  return dry ? `${what} archived on this computer: archived in the cloud too, once carried` : `${what} archived in the cloud too, as on this computer`
}

async function fetchLocalProjectsList() {
  const res = await localFetch(`${RABBIT_BASE}/projects`)
  if (!res.ok) throw new Error(`list projects failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchLocalProject(projectId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}`)
  if (!res.ok) throw new Error(`load project ${projectId} failed: HTTP ${res.status}`)
  return res.json()
}

// The Local Server's body route is /files/:id/download. Until S4b's review
// round 1 this asked /files/:id, which no route serves — the SPA fallback
// answered index.html with a 200, so every migrated "file" was the app's own
// page (R1-BEH-01, found in passing). The download is a read, so the desktop
// records one 'downloaded' event per file, as any other read does.
//
// Review round 2 (R2-BEH-02): a body the desktop cannot read (410 — the NAS
// offline, the LEGAL folder locked to this account as LEGAL_LOCAL_NOTE asks;
// any other refusal) is a FAILURE with its reason, never a quiet "skipped":
// skipped reads as "already in the cloud", and a clean report offers to
// archive and clear the desktop's copy.
async function fetchLocalFileBlob(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/files/${fileId}/download`)
  if (!res.ok) return { blob: null, status: res.status }
  return { blob: await res.blob(), status: res.status }
}

// Already in the cloud? Asked BEFORE any byte moves (review round 2,
// R2-BEH-06): a re-run used to upload the body again and only then meet the
// row's 23505 — and for an invoice or a Legal file, whose key changed in
// round 1, that left an orphan object at the new key. A row this person
// cannot read (another's Legal file) answers nothing, and the upload is then
// refused by the storage policies like any other write they may not make.
// An ERROR is not "not there" (review round 2's re-check, R3-BEH-02): the
// file is then failed with the reason, not uploaded on a guess.
async function cloudFileRow(fileId) {
  try {
    const { data, error } = await supabase.from('files').select('id, storage_path').eq('id', fileId).maybeSingle()
    return error ? { error } : { row: data || null }
  } catch (err) {
    return { error: err }
  }
}

// Post-overhaul S4b (0088): a Legal file may only land in the cloud under its
// LEGAL folder, and only where that folder is LOCKED — asked of the database
// itself, as supabaseAdapter's probe asks (only a `true` counts). Before 0088
// a LEGAL key is an ordinary folder every member can read, so a Legal file is
// not migrated there at all; the report says why.
// S4d (0092): and the Legal GATE must be there too — can_access_project_legal
// asked with the nil project, the same probe the cloud adapter makes — so
// the migration files Legal files only where the adapter would, and its
// refusal names the same two migrations as LEGAL_UNAVAILABLE does. On a
// 0088-only cloud a Legal file would land locked for the money audience
// and a workspace manager running the migration would meet a raw refusal
// instead (review round 2, finding 11).
async function cloudLocksLegal() {
  try {
    const { data, error } = await supabase.rpc('rabbit_money_segment', { seg: LEGAL_SEGMENT })
    if (error || data !== true) return false
    const gate = await supabase.rpc('can_access_project_legal', { p_project: '00000000-0000-0000-0000-000000000000' })
    return !gate?.error
  } catch {
    return false
  }
}

/**
 * Where a desktop file's body goes in the cloud, by the gate it must stay
 * behind: a Legal file under LEGAL, an invoice under INVOICES (0042's money
 * policies key on that third segment — under `files` an invoice's body was
 * readable by every project member), anything else under `files`.
 */
function cloudObjectPathFor(projectId, f) {
  const safeName = (f?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
  const segment = isLegalFile(f) ? LEGAL_SEGMENT : f?.is_financial ? 'INVOICES' : 'files'
  return `projects/${projectId}/${segment}/${f?.id}/${safeName}`
}

// Supabase .insert throws 23505 on pk conflict; we treat that as "already
// migrated" and skip the row silently. Any other error bubbles up.
// Post-overhaul S5b (0090): a desktop row set aside by an open bid version
// arrives LIVE. Bid versions are not copied to the cloud, so nothing there
// could ever bring a set-aside row back; carrying the stamp would hide it for
// good (and 0090's guard would refuse it to anyone but a manager anyway).
function withoutSetAside(row) {
  if (!row || typeof row !== 'object' || !('set_aside_at' in row)) return row
  const { set_aside_at: _dropped, ...rest } = row
  return rest
}

// `ours(row)`, when the caller read what the cloud holds for this project:
// a duplicate is "already in the cloud" only if it is this project's row. An
// id that belongs to another project's row (a copied project file; the same
// desktop moved into a second company) is a FAILURE with its reason, never a
// quiet skip that reads as done (review round 2).
//
// M1: `keys`, for a table with unique keys besides its id. A duplicate on
// one of those is ANOTHER row of this project holding the key (a list's
// name, a list's scene, an edit's place in its chain), never "this row is
// already there": `keys[name]` is 'skip' (the cloud holds the same fact) or
// the sentence of a failure. Postgres names the key in its message, which
// PostgREST passes on; a key the map does not name falls to the id rule.
async function insertOrSkip(table, row, ours = null, keys = null) {
  const { error } = await supabase.from(table).insert(row)
  if (!error) return { status: 'inserted' }
  if (error.code === '23505') { // unique_violation
    const key = uniqueKeyOf(error)
    if (keys && key && keys[key]) {
      if (keys[key] === 'skip') return { status: 'skipped' }
      // The key's place belongs to a row made in the cloud since, which no
      // run can move: the caller counts it, never as an error (review round 1).
      if (keys[key] === 'taken') return { status: 'taken' }
      throw new Error(`${table}: ${keys[key]}`)
    }
    if (!ours || ours(row)) return { status: 'skipped' }
    throw new Error(`${table}: a row with this id is in the cloud but is not this project's, so nothing was written for it (${error.message})`)
  }
  throw new Error(`${table}: ${error.message}`)
}

/** The unique key a 23505 names ("…violates unique constraint "shot_lists_pkey""), or null. */
function uniqueKeyOf(error) {
  const m = /unique constraint "([^"]+)"/.exec(String(error?.message || ''))
  return m ? m[1] : null
}

/** A database function's answer, never a throw: `{ data, error }`. */
async function callRpc(fn, args) {
  try {
    return await supabase.rpc(fn, args)
  } catch (err) {
    return { data: null, error: err }
  }
}

// VW1c (0098): a view or grouping write the cloud adapter refused, said as
// insertOrSkip says its own. Its ids are read first (a row of THIS project is
// skipped without a write), so a duplicate key here is another project's row.
function viewWriteMessage(table, err) {
  if (err?.code === '23505') return `${table}: a row with this id is in the cloud but is not this project's, so nothing was written for it (${err.message})`
  return `${table}: ${err?.message || err}`
}
const hasId = (row) => row?.id != null && row.id !== ''
const isObj = (r) => r != null && typeof r === 'object' && !Array.isArray(r)
const named = (v) => v != null && v !== ''
const idSet = (rows) => new Set((Array.isArray(rows) ? rows : []).filter(isObj).map(r => r.id))
const NO_ID = 'no id recorded, so it was not carried (a second run could not tell it apart from a new one)'

// FX2 (0096): the kinds of a task's item the runner carries — the rows it
// carries (levels and experiences are NOT_CARRIED).
const ITEMS_CARRIED = new Set(['asset', 'scene', 'shot'])

// VW1c (0098): the same three kinds for a grouping (a grouping of levels or
// of experiences names rows the runner leaves here: it stays, counted), and
// the filter fields that name levels and experiences (design §5.1: a linked
// kind's column key is its kind's name).
const GROUPINGS_CARRIED = ITEMS_CARRIED
const LEFT_BEHIND_FILTER_FIELDS = new Set(['level', 'experience'])

/** Does a view filter by a level or an experience (its complete filters, as the screens read them)? */
export function viewFiltersLeftBehind(view) {
  const { config } = readViewConfig(view?.config, view?.table_key)
  return config.filters.some(f => LEFT_BEHIND_FILTER_FIELDS.has(f.field))
}

// FX2 review round 1 (R1-2): a desktop task goes up WITHOUT its scene, shot,
// level and experience links. The cloud has no level or experience column (a
// key it does not know refuses the whole insert, PGRST204), and the tasks land
// before the scenes and shots (BC3) while tasks_scene_fk / tasks_shot_fk are
// not deferrable (23503). VW1m (2026-10-16, her ruling: a task's items are its
// items): WITHOUT ITS ASSET too. The five fields on a desktop row are only the
// older builds' copy of its first item of each kind; every item, its assets
// included, arrives as an item after the rows it names (itemsToCarry), and
// 0097 §4 writes the cloud's copy from them. So a task whose first asset
// failed to go up is no longer refused whole by tasks.asset_id's key: the
// task lands, and only that asset's item fails, in the report. Every other
// key goes up as it always has.
function taskRowForCloud(t) {
  const row = withoutSetAside(t)
  if (!row || typeof row !== 'object') return row
  const {
    asset_id: _asset, scene_id: _scene, shot_id: _shot, level_id: _level, experience_id: _experience, ...rest
  } = row
  return rest
}

// VW1e (0099, 2026-10-25): a desktop asset goes up WITHOUT its level and
// experience links. The runner carries no levels or experiences
// (NOT_CARRIED), so the ids would name rows the cloud does not have — an
// array is no foreign key, so nothing would refuse them, and the asset would
// sit in a level nobody can open. Before 0099 the cloud had no such column at
// all, and a desktop asset that named a level was refused WHOLE (PGRST204).
// Its scene and shot links go up as they always have (BC3 carries both).
export function assetRowForCloud(a) {
  if (!a || typeof a !== 'object') return a
  const { level_ids: _levels, experience_ids: _experiences, ...rest } = a
  return rest
}
// Whether an asset names a level or an experience (what assetRowForCloud
// leaves here), and the not-carried line's words for those assets.
const namesLevelOrExperience = (a) => ['level_ids', 'experience_ids'].some(k => Array.isArray(a?.[k]) && a[k].length > 0)
const ASSET_LEVEL_LINKS_KEY = 'assetLevelLinks'
const assetLevelLinksLabel = (n) => (n === 1 ? "asset's links to levels or experiences" : "assets' links to levels or experiences")

// The items a project's move carries (and counts): the bundle's own, plus one
// for an asset, a scene or a shot a task row names that no item does (a
// bundle no Local Server reconciled), so taskRowForCloud's dropping the
// column loses nothing.
function itemsToCarry(bundle) {
  const items = Array.isArray(bundle?.taskItems) ? bundle.taskItems.filter(i => i && typeof i === 'object') : []
  const named = new Set(items.map(i => `${i.task_id}|${i.entity_type}|${i.entity_id}`))
  const extra = []
  for (const t of Array.isArray(bundle?.tasks) ? bundle.tasks : []) {
    if (!t || t.id == null) continue
    for (const [field, kind] of [['asset_id', 'asset'], ['scene_id', 'scene'], ['shot_id', 'shot']]) {
      const id = t[field]
      if (id == null || id === '') continue
      const key = `${t.id}|${kind}|${id}`
      if (named.has(key)) continue
      named.add(key)
      extra.push({ task_id: t.id, entity_type: kind, entity_id: id, position: 0 })
    }
  }
  return [...items, ...extra]
}

// ── BC3 (B9): the bins' reads and writes ──────────────────────────────────

// PostgREST answers at most `max_rows` (1,000 in supabase/config.toml) and
// says nothing about the rest: every list read here is paged by id until a
// page comes back short (review round 1: an unpaged read of a project's
// clips would have re-uploaded every picture past the thousandth).
const PAGE = 1000

/** The rows of `table` where `column` = `value`, every page, or `{ error }` (a read that fails is said, never read as "none"). */
async function listCloud(table, column, value, columns = '*') {
  const rows = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).eq(column, value).order('id').range(from, from + PAGE - 1)
      if (error) return { error }
      const page = Array.isArray(data) ? data : []
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return { rows }
  } catch (err) {
    return { error: err }
  }
}

/** The ids `table` already holds for a project, as a Set, or `{ error }`. */
async function cloudIds(table, projectId) {
  const r = await listCloud(table, 'project_id', projectId, 'id')
  return r.error ? r : { ids: new Set(r.rows.map(x => x.id)) }
}

/** The company's footage locations: `[{ id, name, unc_path }]`, or `{ error }`. */
async function cloudLocations(workspaceId) {
  const r = await listCloud('bin_locations', 'workspace_id', workspaceId, 'id, name, unc_path')
  return r.error ? r : { rows: r.rows }
}

/**
 * The company's switch (B4, B5a), read once per run. An error reads as OFF
 * (fail closed: not a byte of a picture leaves while the answer is unknown),
 * and the report says the read failed.
 */
async function remoteViewingOn(workspaceId) {
  try {
    const { data, error } = await supabase.from('workspaces').select('remote_viewing_enabled').eq('id', workspaceId).maybeSingle()
    if (error) return { on: false, error }
    return { on: data?.remote_viewing_enabled === true }
  } catch (err) {
    return { on: false, error: err }
  }
}

/** The desktop's picture of a clip (its own poster cache, made on demand): JPEG bytes, or null with the reason. */
async function fetchLocalPoster(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/bin-files/${fileId}/thumbnail`)
  if (!res.ok) return { bytes: null, why: `HTTP ${res.status}` }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { bytes: null, why: 'not a JPEG' }
  if (buf.length > POSTER_MAX_BYTES) return { bytes: null, why: `${buf.length} bytes, over the ${POSTER_MAX_BYTES}-byte cap` }
  return { bytes: buf }
}

/**
 * One clip's picture to the cloud, the way BC2's upload does it: the key
 * under the clip's own project (0091's shape), upsert off, the row's
 * `poster_path` PATCHed after; an object whose row refuses it is taken back.
 */
async function uploadPoster(projectId, fileId, bytes) {
  const key = `projects/${projectId}/bin_files/${fileId}/${Date.now()}-poster.jpg`
  const { error: upErr } = await supabase.storage.from(POSTER_BUCKET).upload(key, bytes, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(/row-level security|petal_bin_posters/.test(upErr.message || '') ? 'the company has not allowed files to be viewed from outside the office network' : `storage upload: ${upErr.message}`)
  // The row must be THIS project's (review round 1, security: an id the
  // bundle shares with another project's row matches nothing here, and the
  // object would have sat under this project's prefix for ever).
  const { data: rows, error: rowErr } = await supabase.from('bin_files').update({ poster_path: key }).eq('id', fileId).eq('project_id', projectId).select('id')
  if (rowErr || !Array.isArray(rows) || rows.length !== 1) {
    try { await supabase.storage.from(POSTER_BUCKET).remove([key]) } catch { /* the refusal below is the answer */ }
    throw new Error(rowErr ? `bin_files: ${rowErr.message}` : 'bin_files: the clip\'s row is no longer in the cloud under this project (removed meanwhile), so its picture was taken back')
  }
  return key
}

const BINS_BUCKETS = ['scenes', 'shots', 'bins', 'binLocations', 'binFiles', 'shotTakes']

function makeReport() {
  return {
    dryRun: false,
    workspaceId: null,
    projects:      { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phases:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // VW1e (0099): `linksLeftBehind` counts the assets that named a level or
    // an experience — those links stay here with the rows they name.
    assets:        { total: 0, inserted: 0, skipped: 0, failed: 0, linksLeftBehind: 0 },
    tasks:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    taskLinks:     { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phaseLinks:    { total: 0, inserted: 0, skipped: 0, failed: 0 },
    files:         { total: 0, inserted: 0, skipped: 0, failed: 0, bytes: 0, placed: 0, linksLetGo: 0 },
    // BC3 (B9): the bins' part. `binFiles.leftBehind` counts the clips whose
    // root nobody named (listed in `clipsLeftBehind`, never dropped);
    // `posters` counts the pictures (uploaded only while the switch is on).
    scenes:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    shots:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    bins:          { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binLocations:  { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binFiles:      { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    // `orphans`: takes of a shot or clip removed on this computer — not
    // carried, not counted in `total`, not an error (ORPHAN_TAKES).
    shotTakes:     { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0, orphans: 0 },
    // FX2 (0096): a task's items (the assets, scenes and shots it is about).
    // `leftBehind`: its levels and experiences, which the runner does not
    // carry (NOT_CARRIED), so their items stay here too.
    taskItems:     { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    // VW1c (0098): the saved views and groupings. `tableViews.filtersLeftBehind`
    // counts the views (carried like any other) that filter by a level or an
    // experience: those rows stay here, so in the cloud the filter matches
    // nothing (VIEW_FILTERS_LEFT_BEHIND). `itemGroupings.leftBehind`: the
    // groupings of levels or experiences, which stay with them (and are
    // named in `notCarried`).
    tableViews:    { total: 0, inserted: 0, skipped: 0, failed: 0, filtersLeftBehind: 0 },
    itemGroupings: { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    // M1 (night 3). A row the run does not try to carry is counted beside
    // `total`, never in it: `trashed` (in this computer's Recently deleted,
    // or marked removed), `orphans` (on a row removed on this computer, or in
    // the cloud's trash), `leftBehind` (part 2's, or a kind the cloud cannot
    // hold), a folder whose place is `taken`. `archived`: the lists and edits
    // archived in the cloud as on this computer; `files.placed`: the files
    // filed in a folder.
    milestones:    { total: 0, inserted: 0, skipped: 0, failed: 0, trashed: 0, phaseLetGo: 0 },
    comments:      { total: 0, inserted: 0, skipped: 0, failed: 0, trashed: 0, orphans: 0, leftBehind: 0 },
    shotLists:     { total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0 },
    shotListItems: { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0 },
    edits:         { total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 0 },
    folders:       { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0, orphans: 0, taken: 0 },
    // What the project rows leave on this computer (projectRowForCloud): how
    // many name a locked or open bid version (part 2), how many a folder,
    // the statuses the cloud does not have (status → projects) and the values
    // it cannot hold (how many projects; word → projects), these two only for
    // a project that arrives; and the lists and edits archived here that the
    // cloud holds live.
    projectsLeftAtHome: { bidVersions: 0, folders: 0, statuses: {}, withValues: 0, values: {} },
    liveInCloud: 0,
    posters:       { total: 0, uploaded: 0, skipped: 0, failed: 0, switchOff: 0 },
    // What the bundles hold that the runner does not carry (notCarriedOf),
    // summed over the projects: `[{ key, label, count }]`.
    notCarried: [],
    // The question: every distinct root of every project's clips, with what
    // the answers (if any) resolved it to — `[{ root, key, kind, count,
    // projects, resolved }]` — and the company's locations it was asked
    // against, so the panel can resolve a typed answer the same way.
    footageRoots: [],
    footageLocations: [],
    clipsLeftBehind: [],
    remoteViewing: null,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

// The desktop bundle carries task→task and phase→phase edges in ONE array,
// told apart by `kind` (literally 'phase', or anything else = task) — the
// adapter's dependencyKind is the rule.
function countLinks(dependencies) {
  const out = { task: 0, phase: 0 }
  for (const dep of dependencies ?? []) out[dependencyKind(dep)]++
  return out
}
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

function bumpInserted(bucket) { bucket.total++; bucket.inserted++ }
function bumpSkipped(bucket)  { bucket.total++; bucket.skipped++ }
function bumpFailed(bucket)   { bucket.total++; bucket.failed++ }

/**
 * Migrate local RABBIT data into the given workspace.
 *
 * @param {object} opts
 * @param {string} opts.workspaceId Target workspace UUID.
 * @param {boolean} [opts.dryRun]   If true, enumerate only; no writes.
 * @param {(msg: string) => void} [opts.onProgress] Progress callback.
 * @param {object} [opts.locations] BC3 (B9): the answers to "Which footage
 *   location is this?", keyed by the root's key (binsMigration.pathKey):
 *   `{ unc_path, name? }` names a location (an existing one by address, or
 *   a new one), `{ skip: true }` leaves the root's clips on this computer.
 *   The dry run lists the roots to ask about (`report.footageRoots`).
 * @returns {Promise<object>} Report object with per-table counters.
 */
export async function runMigration({ workspaceId, dryRun = false, onProgress, locations = {} }) {
  if (!workspaceId) throw new Error('workspaceId required')
  const report = makeReport()
  report.dryRun      = dryRun
  report.workspaceId = workspaceId

  const note = (m) => { try { onProgress?.(m) } catch { /* swallow */ } }
  // BC3: the company's locations (read once, when a project has clips), the
  // switch (read once, when a clip could have a picture), the roots of every
  // project (the question), and the locations made in this run.
  const binsState = { locations: null, locationsError: null, switch: null, roots: [], answers: locations || {} }
  const notCarried = new Map()
  // One line of the not-carried sentence, summed over the projects: its
  // words from NOT_CARRIED (binsMigration.js) unless given, `part2` when part
  // 2 of the migration carries it (M1: the panel says the two apart).
  const addNotCarried = (key, count, { label, part2 } = {}) => {
    if (!count) return
    const e = notCarried.get(key) || { key, count: 0 }
    e.count += count
    e.label = label ? label(e.count) : notCarriedLabel(key, e.count)
    e.part2 = part2 ?? notCarriedPart2(key)
    notCarried.set(key, e)
  }
  const countNotCarried = (bundle) => {
    for (const { key, count } of notCarriedOf(bundle)) addNotCarried(key, count)
  }
  // The live takes of a bundle: those whose shot and clip are in it. The rest
  // are the desktop's orphans (kept for undo, shown to nobody): not carried.
  const liveTakesOf = (bundle) => {
    const takes = bundle.shotTakes ?? []
    const shots = new Set((bundle.shots ?? []).map(s => s?.id))
    const clips = new Set((bundle.binFiles ?? []).map(c => c?.id))
    const live = takes.filter(t => t && shots.has(t.shot_id) && clips.has(t.bin_file_id))
    const orphans = takes.length - live.length
    if (orphans) { report.shotTakes.orphans += orphans; note(`  ${ORPHAN_TAKES(orphans)}`) }
    return live
  }
  const companyLocations = async () => {
    if (binsState.locations) return binsState.locations
    const r = await cloudLocations(workspaceId)
    if (r.error) { binsState.locationsError = r.error; binsState.locations = []; report.errors.push({ scope: 'bin_locations', message: `could not read the company's footage locations: ${r.error.message || r.error}` }) }
    else binsState.locations = r.rows
    report.footageLocations = binsState.locations.map(l => ({ id: l.id, name: l.name, unc_path: l.unc_path }))
    return binsState.locations
  }
  const switchOn = async () => {
    if (binsState.switch) return binsState.switch.on
    binsState.switch = await remoteViewingOn(workspaceId)
    report.remoteViewing = binsState.switch.on
    if (binsState.switch.error) report.errors.push({ scope: 'posters', message: `could not read the company's remote-viewing switch, so no picture was uploaded: ${binsState.switch.error.message || binsState.switch.error}` })
    return binsState.switch.on
  }
  // The answer for a root, resolved against the company's list: cached per
  // root, so one new location serves every clip and every project under it.
  const resolvedAnswers = new Map()
  const resolveRoot = async (root) => {
    if (resolvedAnswers.has(root.key)) return resolvedAnswers.get(root.key)
    const existing = await companyLocations()
    const r = resolveRootAnswer(root, binsState.answers[root.key], existing)
    resolvedAnswers.set(root.key, r)
    return r
  }
  // A location named now: made once (a race with a teammate naming the same
  // share reads back the row they made).
  const locationIdFor = async (resolved) => {
    if (resolved.kind === 'existing') return resolved.location.id
    if (resolved.location) return resolved.location.id
    const row = { id: crypto.randomUUID(), workspace_id: workspaceId, name: resolved.name, unc_path: resolved.unc_path }
    const r = await insertOrSkip('bin_locations', row)
    if (r.status === 'inserted') {
      bumpInserted(report.binLocations)
      resolved.location = row
      binsState.locations.push(row)
      report.footageLocations.push({ id: row.id, name: row.name, unc_path: row.unc_path })
      note(`  Footage location "${row.name}" (${row.unc_path}) named`)
      return row.id
    }
    // Already there (another run, a teammate): read it back by address.
    bumpSkipped(report.binLocations)
    const again = await cloudLocations(workspaceId)
    const hit = (again.rows || []).find(l => pathKey(l.unc_path) === pathKey(resolved.unc_path))
    if (!hit) throw new Error(`bin_locations: "${resolved.unc_path}" is already in the company's list but could not be read back`)
    resolved.location = hit
    binsState.locations = again.rows
    return hit.id
  }

  // VW1c (0098): the views' part. The cloud adapter writes the rows (its
  // column allowlist, its refusals in words: one vocabulary) and reads what
  // the cloud already holds of a project's views and groupings — its paged
  // reads, which are its probe too (a cloud without 0098 answers none, and
  // says so through tableViewsAvailable).
  const viewsAdapter = supabaseAdapter()
  const viewsPartOf = (bundle) => {
    const groupings = (bundle.itemGroupings ?? []).filter(g => g && typeof g === 'object')
    return {
      views: (bundle.tableViews ?? []).filter(v => v && typeof v === 'object'),
      carried: groupings.filter(g => GROUPINGS_CARRIED.has(g.kind)),
      left: groupings.filter(g => !GROUPINGS_CARRIED.has(g.kind)),
    }
  }
  // `{ views, groupings }` (the ids the cloud holds for the project, as
  // Sets), `{ absent: true }` (no 0098 there) or `{ error }` (a read that
  // failed is said, never read as "none there").
  const cloudViewIds = async (projectId) => {
    try {
      const [views, groupings] = await Promise.all([viewsAdapter.listTableViews(projectId), viewsAdapter.listItemGroupings(projectId)])
      if (!viewsAdapter.tableViewsAvailable()) return { absent: true }
      return { views: new Set(views.map(r => r.id)), groupings: new Set(groupings.map(r => r.id)) }
    } catch (err) {
      return { error: err }
    }
  }
  // Counted alike by the dry run and the real one: the groupings that stay
  // (and the not-carried line that names them), and the views whose level or
  // experience filter will match nothing up there.
  const countViewsLeftBehind = (part) => {
    report.itemGroupings.total += part.left.length
    report.itemGroupings.leftBehind += part.left.length
    report.tableViews.filtersLeftBehind += part.views.filter(viewFiltersLeftBehind).length
    addNotCarried(LEVEL_GROUPINGS_KEY, part.left.length, { label: levelGroupingsLabel, part2: true })
  }
  // VW1e (0099), counted alike by the dry run and the real one: the assets
  // whose level and experience links stay here (assetRowForCloud sends the
  // asset without them), and the not-carried line that says so.
  const countAssetLinksLeftBehind = (assets) => {
    const n = (assets ?? []).filter(namesLevelOrExperience).length
    report.assets.linksLeftBehind += n
    addNotCarried(ASSET_LEVEL_LINKS_KEY, n, { label: assetLevelLinksLabel, part2: true })
  }
  const viewsNote = (part, views, groupings, where = '') => `  ${plural(views, 'saved view')} and ${plural(groupings, 'grouping')}${where}` +
    (part.left.length ? `; ${plural(part.left.length, 'grouping')} of levels or experiences ${part.left.length === 1 ? 'stays' : 'stay'} on this computer` : '')

  // ── M1 (night 3): the project row and the five kinds ───────────────────
  //
  // Each kind is one function for the dry run and the real one alike
  // (`dry`: counted as the real run would take it, nothing written), so the
  // dry run's promise is the real run's code. A row of the five kinds keeps
  // its id; a second run skips what is there, and writes nothing for it.

  // What a project row leaves on this computer, said per project. Its status
  // and the values the cloud cannot hold are said only for a project that
  // arrives in this run (`arriving`; review round 2: on a second run, or for
  // a refused project, "it arrives as active" was untrue).
  const countProjectLeftAtHome = (bundle, arriving) => {
    const home = projectLeftAtHome(bundle.project)
    if (home.bidVersions) { report.projectsLeftAtHome.bidVersions++; note(`  ${BID_VERSIONS_PART_2(1)}`) }
    if (home.folder) { report.projectsLeftAtHome.folders++; note(`  ${PROJECT_FOLDER_STAYS(1)}`) }
    if (!arriving) return
    if (home.status) {
      const st = report.projectsLeftAtHome.statuses
      st[home.status] = (st[home.status] || 0) + 1
      note(`  ${STATUS_NOT_IN_CLOUD(1, [home.status])}`)
    }
    if (home.values.length) {
      report.projectsLeftAtHome.withValues++
      const v = report.projectsLeftAtHome.values
      for (const w of home.values) v[w] = (v[w] || 0) + 1
      note(`  ${VALUES_NOT_IN_CLOUD(1, home.values)}`)
    }
  }
  // Whether the project is in the cloud already, for the dry run: `{ there }`, or `{ error }`.
  const cloudProjectThere = async (projectId) => {
    try {
      const { data, error } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
      return error ? { error } : { there: !!data }
    } catch (err) {
      return { error: err }
    }
  }

  // This project's key dates in the cloud by id, its trash included: a key
  // date removed there keeps its id (0067), so a second run skips it rather
  // than bringing it back. `{ ids }`, or `{ error }` for the caller to say.
  // The trash is read through 0067's index (a trashed row is invisible to a
  // read of the table); a project not in the cloud yet has neither.
  const cloudMilestoneIds = async (projectId) => {
    const live = await listCloud('milestones', 'project_id', projectId, 'id')
    if (live.error) return { error: live.error }
    const ids = new Set(live.rows.map(r => r.id))
    const { data, error } = await callRpc('milestones_trash_index', { p_project_id: projectId })
    if (!error) {
      for (const r of Array.isArray(data) ? data : []) if (r?.id) ids.add(r.id)
      return { ids }
    }
    try {
      const there = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
      if (!there.error && !there.data) return { ids }
    } catch { /* the trash's refusal is the answer */ }
    return { error }
  }

  // Key dates (0067), after the phases they may sit in.
  const carryMilestones = async (bundle, projectId, stateOf, dry) => {
    const all = (bundle.milestones ?? []).filter(isObj)
    const live = all.filter(m => !named(m.deleted_at))
    if (all.length > live.length) {
      report.milestones.trashed += all.length - live.length
      note(`  ${KEY_DATES_TRASHED(all.length - live.length)}`)
    }
    if (!live.length) return
    const known = await cloudMilestoneIds(projectId)
    if (known.error) report.errors.push({ scope: 'milestones', projectId, message: `could not read the key dates already in the cloud, so one refused as a duplicate reads as already there: ${known.error.message || known.error}` })
    let phaseLetGo = 0
    for (const m of live) {
      if (!hasId(m)) { report.errors.push({ scope: 'milestone', projectId, message: NO_ID }); bumpFailed(report.milestones); continue }
      if (known.ids?.has(m.id)) { bumpSkipped(report.milestones); continue }
      const row = milestoneRowForCloud(m, projectId)
      const name = m.title || m.name || m.id
      // Its phase is a plain foreign key (no project in it): only a phase the
      // cloud shows under THIS project is kept; one that did not land in this
      // run fails the key date with it (a second run brings both); one
      // removed on this computer (the desktop's phase delete leaves its key
      // dates' link), or not this project's, is let go — counted and said,
      // not an error (review round 1: an error made a first run not Done for
      // a thing no run could change).
      let letGo = false
      if (named(row.phase_id)) {
        const st = await stateOf('phases', row.phase_id)
        if (st === 'unread') { report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: whether its phase is in the cloud could not be checked (the read failed), so the key date was not carried (run again)` }); bumpFailed(report.milestones); continue }
        if (st === 'failed') { report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: its phase is not in the cloud, so the key date was not carried (a second run brings both)` }); bumpFailed(report.milestones); continue }
        if (st === 'gone') { row.phase_id = null; letGo = true }
      }
      if (dry) { bumpInserted(report.milestones); if (letGo) phaseLetGo++; continue }
      try {
        const r = await insertOrSkip('milestones', row, known.ids ? (x) => known.ids.has(x.id) : null)
        r.status === 'inserted' ? bumpInserted(report.milestones) : bumpSkipped(report.milestones)
        if (letGo && r.status === 'inserted') phaseLetGo++
      } catch (err) {
        report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: ${err.message}` })
        bumpFailed(report.milestones)
      }
    }
    report.milestones.phaseLetGo += phaseLetGo
    if (phaseLetGo) note(`  ${KEY_DATES_PHASE_LET_GO(phaseLetGo)}`)
  }

  // Comments (0000), after the rows they hang on. The dry run counts the
  // ones whose row goes up (Total, as for phases, assets and tasks: which are
  // there already the cloud cannot say by project — a comment has none).
  const carryComments = async (bundle, projectId, stateOf, dry) => {
    const counts = { removed: 0, gone: 0, elsewhere: 0 }
    for (const c of (bundle.comments ?? []).filter(isObj)) {
      if (named(c.deleted_at)) { counts.removed++; continue }
      const table = COMMENT_TARGETS[c.entity_type]
      if (!table) { counts.elsewhere++; continue }
      const st = table === 'projects' ? (String(c.entity_id) === String(projectId) ? 'landed' : 'gone') : await stateOf(table, c.entity_id)
      if (st === 'gone') { counts.gone++; continue }
      if (st === 'unread') { report.errors.push({ scope: 'comment', projectId, id: c.id, message: `whether its ${c.entity_type} is in the cloud could not be checked (the read failed), so the comment was not carried (run again)` }); bumpFailed(report.comments); continue }
      if (st === 'failed') { report.errors.push({ scope: 'comment', projectId, id: c.id, message: `its ${c.entity_type} is not in the cloud, so the comment was not carried (a second run brings both)` }); bumpFailed(report.comments); continue }
      if (!hasId(c)) { report.errors.push({ scope: 'comment', projectId, message: NO_ID }); bumpFailed(report.comments); continue }
      if (dry) { report.comments.total++; continue }
      try {
        // A comment removed in the cloud keeps its id there (0014), unseen
        // by a read: a duplicate counts as already there, never comes back.
        const r = await insertOrSkip('comments', commentRowForCloud(c))
        r.status === 'inserted' ? bumpInserted(report.comments) : bumpSkipped(report.comments)
      } catch (err) {
        report.errors.push({ scope: 'comment', projectId, id: c.id, message: err.message })
        bumpFailed(report.comments)
      }
    }
    report.comments.trashed += counts.removed
    report.comments.orphans += counts.gone
    report.comments.leftBehind += counts.elsewhere
    addNotCarried('commentsElsewhere', counts.elsewhere)
    if (counts.removed) note(`  ${COMMENTS_REMOVED(counts.removed)}`)
    if (counts.gone) note(`  ${COMMENTS_ON_GONE_ROWS(counts.gone)}`)
  }

  // The project's active shot list in the cloud: `{ id }` (null: none), or `{ error }`.
  const cloudActiveList = async (projectId) => {
    try {
      const { data, error } = await supabase.from('projects').select('active_shot_list_id').eq('id', projectId).maybeSingle()
      return error ? { error } : { id: data?.active_shot_list_id ?? null }
    } catch (err) {
      return { error: err }
    }
  }
  const nameKeyOf = (row) => `${String(row?.title ?? '').trim()}|${row?.version ?? 1}`

  // Shot lists, their items and edits (0084), after the scenes and shots.
  // A list arrives LIVE (0084 refuses a row inserted archived — 42501,
  // measured) and is archived after, through archive_shot_list(), as the
  // client archives one; the active list is set through
  // set_active_shot_list() once the lists are in. Items keep their list and
  // position; edits come each after the edit it continues (0084's guard).
  // `landed`: the scenes and shots in the cloud for this project.
  const carryShotLists = async (bundle, projectId, landed, dry) => {
    const lists = (bundle.shotLists ?? []).filter(isObj)
    const items = (bundle.shotListItems ?? []).filter(isObj)
    const edits = (bundle.edits ?? []).filter(isObj)
    if (!lists.length && !items.length && !edits.length) return
    const read = async (table, columns, rows) => {
      if (!rows.length) return { rows: [] }
      const r = await listCloud(table, 'project_id', projectId, columns)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds, so a row refused as a duplicate reads as already there: ${r.error.message || r.error}` })
      return r
    }
    const haveLists = await read('shot_lists', 'id, title, version, archived_at', lists)
    const haveItems = await read('shot_list_items', 'id, shot_list_id, scene_id, shot_id', items)
    const haveEdits = await read('edits', 'id, shot_list_id, title, version, parent_edit_id, archived_at', edits)
    const cloudLists = new Map((haveLists.rows || []).map(l => [l.id, l]))
    const cloudEdits = new Map((haveEdits.rows || []).map(e => [e.id, e]))
    const listNames = new Set((haveLists.rows || []).map(nameKeyOf))
    const editNames = new Set((haveEdits.rows || []).map(e => `${e.shot_list_id}|${nameKeyOf(e)}`))
    const listsHere = idSet(lists)
    const scenesHere = idSet(bundle.scenes)
    const shotsHere = idSet(bundle.shots)
    const landedLists = new Set()
    const insertedLists = new Set()
    let liveThere = 0
    for (const l of lists) {
      if (!hasId(l)) { report.errors.push({ scope: 'shot_list', projectId, message: NO_ID }); bumpFailed(report.shotLists); continue }
      const there = cloudLists.get(l.id)
      if (there) { bumpSkipped(report.shotLists); landedLists.add(l.id); if (isArchived(l) && !isArchived(there)) liveThere++; continue }
      if (listNames.has(nameKeyOf(l))) { report.errors.push({ scope: 'shot_list', projectId, id: l.id, message: SHOT_LIST_NAME_TAKEN(listLabel(l)) }); bumpFailed(report.shotLists); continue }
      if (dry) { bumpInserted(report.shotLists); landedLists.add(l.id); insertedLists.add(l.id); continue }
      try {
        const r = await insertOrSkip('shot_lists', shotListRowForCloud(l, projectId), haveLists.error ? null : (x) => cloudLists.has(x.id), { shot_lists_project_title_version_key: SHOT_LIST_NAME_TAKEN(listLabel(l)) })
        if (r.status === 'inserted') { bumpInserted(report.shotLists); insertedLists.add(l.id) } else bumpSkipped(report.shotLists)
        landedLists.add(l.id)
      } catch (err) {
        report.errors.push({ scope: 'shot_list', projectId, id: l.id, message: err.message })
        bumpFailed(report.shotLists)
      }
    }
    const pairOf = (i) => (named(i?.scene_id) ? `${i.shot_list_id}|scene|${i.scene_id}` : `${i?.shot_list_id}|shot|${i?.shot_id}`)
    const itemIds = new Set((haveItems.rows || []).map(i => i.id))
    const itemPairs = new Set((haveItems.rows || []).map(pairOf))
    let itemsGone = 0
    for (const it of itemsInListOrder(items, lists)) {
      if (!hasId(it)) { report.errors.push({ scope: 'shot_list_item', projectId, message: NO_ID }); bumpFailed(report.shotListItems); continue }
      if (!landedLists.has(it.shot_list_id)) {
        if (listsHere.has(it.shot_list_id)) { report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: 'its shot list is not in the cloud, so the item was not carried (a second run brings both)' }); bumpFailed(report.shotListItems) }
        else itemsGone++
        continue
      }
      if (itemIds.has(it.id) || itemPairs.has(pairOf(it))) { bumpSkipped(report.shotListItems); continue }
      const kind = named(it.scene_id) ? 'scene' : 'shot'
      const rowId = kind === 'scene' ? it.scene_id : it.shot_id
      if (!(kind === 'scene' ? landed.scenes : landed.shots).has(rowId)) {
        if ((kind === 'scene' ? scenesHere : shotsHere).has(rowId)) { report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: `its ${kind} is not in the cloud, so the item was not carried (a second run brings both)` }); bumpFailed(report.shotListItems) }
        else itemsGone++
        continue
      }
      if (dry) { bumpInserted(report.shotListItems); continue }
      try {
        const r = await insertOrSkip('shot_list_items', shotListItemRowForCloud(it, projectId), haveItems.error ? null : (x) => itemIds.has(x.id), { shot_list_items_list_scene_key: 'skip', shot_list_items_list_shot_key: 'skip' })
        r.status === 'inserted' ? bumpInserted(report.shotListItems) : bumpSkipped(report.shotListItems)
      } catch (err) {
        report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: err.message })
        bumpFailed(report.shotListItems)
      }
    }
    report.shotListItems.orphans += itemsGone
    if (itemsGone) note(`  ${ITEMS_ON_GONE_ROWS(itemsGone)}`)
    const landedEdits = new Set()
    const insertedEdits = new Set()
    // 0084's one chain per list (one edit with no parent per list, one child
    // per edit; the archived count, as the unconditional indexes count them):
    // who holds each place — the cloud's edits as read, then each edit of this
    // run as it lands (or, in the dry run, would). A desktop edit whose place
    // another edit holds — one made in the cloud since, or a second chain an
    // older version kept on this computer (rabbitShotLists.cjs leaves such a
    // bundle editable) — and every edit continuing it are counted and named,
    // never an error (review rounds 1 and 2): an edit cannot be moved, so no
    // run could carry it, and the dry run says what the real run will do.
    const rootOf = new Map() // list → the edit with no parent
    const childOf = new Map() // edit → the edit continuing it
    for (const e of haveEdits.rows || []) {
      if (named(e.parent_edit_id)) childOf.set(e.parent_edit_id, e.id)
      else rootOf.set(e.shot_list_id, e.id)
    }
    const holdPlace = (e) => (named(e.parent_edit_id) ? childOf.set(e.parent_edit_id, e.id) : rootOf.set(e.shot_list_id, e.id))
    const takenEdits = new Set()
    for (const e of editsParentsFirst(edits)) {
      if (!hasId(e)) { report.errors.push({ scope: 'edit', projectId, message: NO_ID }); bumpFailed(report.edits); continue }
      const there = cloudEdits.get(e.id)
      if (there) { bumpSkipped(report.edits); landedEdits.add(e.id); if (isArchived(e) && !isArchived(there)) liveThere++; continue }
      const fail = (message) => { report.errors.push({ scope: 'edit', projectId, id: e.id, message: `${listLabel(e)}: ${message}` }); bumpFailed(report.edits) }
      if (!landedLists.has(e.shot_list_id)) { fail('its shot list is not in the cloud, so the edit was not carried (a second run brings both)'); continue }
      const holder = !named(e.parent_edit_id) ? rootOf.get(e.shot_list_id)
        : takenEdits.has(e.parent_edit_id) ? e.parent_edit_id
          : landedEdits.has(e.parent_edit_id) ? childOf.get(e.parent_edit_id) : undefined
      if (holder !== undefined && holder !== e.id) { takenEdits.add(e.id); continue }
      if (named(e.parent_edit_id) && !landedEdits.has(e.parent_edit_id)) { fail('the edit it continues is not in the cloud, so it was not carried (a second run brings both)'); continue }
      if (editNames.has(`${e.shot_list_id}|${nameKeyOf(e)}`)) { fail(EDIT_NAME_TAKEN(listLabel(e))); continue }
      if (dry) { bumpInserted(report.edits); landedEdits.add(e.id); insertedEdits.add(e.id); holdPlace(e); continue }
      try {
        const r = await insertOrSkip('edits', editRowForCloud(e, projectId), haveEdits.error ? null : (x) => cloudEdits.has(x.id), {
          edits_list_title_version_key: EDIT_NAME_TAKEN(listLabel(e)), edits_one_root_per_list_key: 'taken', edits_one_child_key: 'taken',
        })
        if (r.status === 'taken') { takenEdits.add(e.id); continue }
        if (r.status === 'inserted') { bumpInserted(report.edits); insertedEdits.add(e.id) } else bumpSkipped(report.edits)
        landedEdits.add(e.id)
        holdPlace(e)
      } catch (err) {
        report.errors.push({ scope: 'edit', projectId, id: e.id, message: err.message })
        bumpFailed(report.edits)
      }
    }
    report.edits.taken += takenEdits.size
    if (takenEdits.size) note(`  ${EDITS_CHAIN_TAKEN(takenEdits.size)}`)
    report.liveInCloud += liveThere
    if (liveThere) note(`  ${LIVE_IN_CLOUD(liveThere)}`)
    note(`  ${plural(lists.length, 'shot list')} with ${plural(items.length, 'item')} and ${plural(edits.length, 'edit')}`)
    // The active list: this computer's, once this run carried it, live, and
    // only where no list is active in the cloud yet (a teammate's choice is
    // left alone; a second run sets nothing).
    const activeId = bundle.project?.active_shot_list_id
    const active = named(activeId) ? lists.find(l => l.id === activeId) : null
    if (active && insertedLists.has(active.id) && !isArchived(active)) {
      if (dry) note(`  "${listLabel(active)}" will be the active shot list in the cloud, if none is active there`)
      else {
        const cur = await cloudActiveList(projectId)
        const refuse = (why) => report.errors.push({ scope: 'shot_list', projectId, id: active.id, message: `"${listLabel(active)}" was not made the active shot list in the cloud: ${why} (a workspace admin or the project's manager can, on the Scenes tab)` })
        if (cur.error) refuse(`its active list could not be read (${cur.error.message || cur.error})`)
        else if (cur.id == null) {
          const { error } = await callRpc('set_active_shot_list', { p_project: projectId, p_list: active.id })
          if (error) refuse(error.message || String(error))
          else note(`  "${listLabel(active)}" is the active shot list in the cloud`)
        }
      }
    }
    // Archived on this computer: archived in the cloud too, through 0084's
    // functions — the edits before their lists (an untouched list's maker
    // may archive it only once no live edit is on it, 0086), and only what
    // this run carried (a second run archives nothing; a list a teammate
    // restored in the cloud stays restored).
    const toArchive = [
      ...edits.filter(e => insertedEdits.has(e.id) && isArchived(e)).map(row => ({ row, fn: 'archive_edit', args: { p_edit: row.id, p_archived: true }, bucket: report.edits, scope: 'edit' })),
      ...lists.filter(l => insertedLists.has(l.id) && isArchived(l)).map(row => ({ row, fn: 'archive_shot_list', args: { p_list: row.id, p_archived: true }, bucket: report.shotLists, scope: 'shot_list' })),
    ]
    if (!toArchive.length) return
    if (dry) {
      for (const a of toArchive) a.bucket.archived++
      note(`  ${ARCHIVED_AGAIN(toArchive.map(a => `"${listLabel(a.row)}"`))}`)
      return
    }
    for (const a of toArchive) {
      const { error } = await callRpc(a.fn, a.args)
      if (error) report.errors.push({ scope: a.scope, projectId, id: a.row.id, message: `"${listLabel(a.row)}" is archived on this computer but live in the cloud: ${error.message || error}` })
      else a.bucket.archived++
    }
  }

  // Folders (0041), after the assets, scenes and shots they are of, parents
  // first; each a row by its path, matched where the cloud holds it (by id,
  // by its row, or at its path) and never made twice. Answers `{ cloudOf,
  // failed }`: the folder in the cloud of each desktop folder that is there
  // (desktop id → cloud id), which the files are filed in, and the desktop
  // folders that did not land in this run, whose files wait with them (review
  // round 2: a file filed at the top meanwhile stayed there, a second run
  // skipping it). `state(fk, id)`: the row a folder is of, as this run left
  // it (folderDecision says how each answer is taken).
  const FOLDER_READ = 'id, path, kind, asset_id, scene_id, shot_id, level_id, experience_id'
  const carryFolders = async (bundle, projectId, state, dry) => {
    const folderOf = new Map()
    const failed = new Set()
    const folders = (bundle.folders ?? []).filter(isObj)
    if (!folders.length) return { cloudOf: folderOf, failed }
    const have = await listCloud('folders', 'project_id', projectId, FOLDER_READ)
    if (have.error) {
      report.errors.push({ scope: 'folders', projectId, message: `could not read the project's folders in the cloud, so none was carried, nor any file filed in one (run again): ${have.error.message || have.error}` })
      report.folders.total += folders.length
      report.folders.failed += folders.length
      for (const f of folders) failed.add(f.id)
      return { cloudOf: folderOf, failed }
    }
    let cloud = cloudFolderIndex(have.rows)
    const decided = new Map()
    const counts = { left: 0, gone: 0, taken: 0 }
    for (const f of foldersParentsFirst(folders)) {
      if (!hasId(f)) { report.errors.push({ scope: 'folder', projectId, message: NO_ID }); bumpFailed(report.folders); continue }
      const parent = f.kind === 'root' ? null : decided.get(f.parent_id)
      let d = folderDecision(f, { parent, cloud, state })
      const where = f.path || 'the project folder'
      if (d.action === 'insert' && dry) d = { action: 'inserted', cloudId: f.id }
      else if (d.action === 'insert') {
        try {
          const { error } = await supabase.from('folders').insert(folderRowForCloud(f, projectId, d.parentCloudId))
          if (!error) d = { action: 'inserted', cloudId: f.id }
          else if (error.code === '23505') {
            // Made meanwhile (a teammate, the cloud's own planner): read
            // again and decide again — matched, or its place taken by a
            // namesake; anything else is an id another project holds.
            const again = await listCloud('folders', 'project_id', projectId, FOLDER_READ)
            if (!again.error) cloud = cloudFolderIndex(again.rows)
            const d2 = again.error ? null : folderDecision(f, { parent, cloud, state })
            if (d2?.action !== 'matched' && d2?.action !== 'taken') throw new Error(`folders: a folder with this id is in the cloud but is not this project's, so nothing was written for it (${error.message})`)
            d = d2
          } else throw new Error(`folders: ${error.message}`)
        } catch (err) {
          report.errors.push({ scope: 'folder', projectId, id: f.id, message: `${where}: ${err.message}` })
          d = { action: 'failed', said: true }
        }
      }
      if (d.action === 'inserted') bumpInserted(report.folders)
      else if (d.action === 'matched') bumpSkipped(report.folders)
      else if (d.action === 'left') counts.left++
      else if (d.action === 'orphan') counts.gone++
      else if (d.action === 'taken') counts.taken++
      else if (d.action === 'failed') {
        if (!d.said) report.errors.push({ scope: 'folder', projectId, id: f.id, message: `${where}: ${d.why}, so the folder was not carried (a second run brings it)` })
        bumpFailed(report.folders)
        failed.add(f.id)
      }
      decided.set(f.id, d)
      if (d.cloudId) folderOf.set(f.id, d.cloudId)
    }
    report.folders.leftBehind += counts.left
    report.folders.orphans += counts.gone
    report.folders.taken += counts.taken
    addNotCarried('levelFolders', counts.left)
    if (counts.gone) note(`  ${FOLDERS_OF_GONE_ROWS(counts.gone)}`)
    if (counts.taken) note(`  ${FOLDERS_TAKEN(counts.taken)}`)
    return { cloudOf: folderOf, failed }
  }
  // A file's own links, the table of each (0000's phase, asset and task;
  // 0043's scene and shot).
  const FILE_LINKS = { phase_id: 'phases', asset_id: 'assets', task_id: 'tasks', scene_id: 'scenes', shot_id: 'shots' }
  // The cloud folder a desktop file is filed in, by the desktop's own rule
  // (desktopFolderOfFile, fileTree.js's), or null (the project's top).
  const cloudFolderOfFile = (file, bundle, folderOf) => {
    const here = desktopFolderOfFile(file, bundle.folders)
    return here ? (folderOf.get(here.id) ?? null) : null
  }

  // Fetch the local project list. On a fresh install there may be no local
  // server — handle a 404/network error as "nothing to migrate".
  let localProjects
  try {
    localProjects = await fetchLocalProjectsList()
  } catch (err) {
    report.errors.push({ scope: 'list', message: err.message })
    report.finishedAt = new Date().toISOString()
    return report
  }

  note(`Found ${localProjects.length} local project${localProjects.length === 1 ? '' : 's'}.`)
  // Asked once, and only when there is something to write.
  let legalLocked = null

  for (const { id: projectId, title } of localProjects) {
    note(`• ${title ?? projectId}`)
    let bundle
    try {
      bundle = await fetchLocalProject(projectId)
    } catch (err) {
      report.errors.push({ scope: 'load', projectId, message: err.message })
      bumpFailed(report.projects)
      continue
    }

    // Shape tolerance — localServerAdapter.loadProject returns
    //   { project, phases, assets, tasks, dependencies, taskLinks, files,
    //     assetVersions, comments, ingestionRuns }
    // Dry run: count only — and say the link counts out loud. A project with
    // edges used to migrate to an empty Gantt with no line in the report
    // (docs/OUTSTANDING.md, closed by Track A A2); the counts are the promise
    // the real run is then held to.
    if (dryRun) {
      // Review round 2: whether the project is there already, so its status
      // line is said only for a project that will arrive (as the real run
      // says it), and a second dry run counts it as there.
      const projectThere = await cloudProjectThere(projectId)
      if (projectThere.error) report.errors.push({ scope: 'project', projectId, message: `could not read whether the project is in the cloud already: ${projectThere.error.message || projectThere.error}` })
      if (projectThere.there) bumpSkipped(report.projects)
      else bumpInserted(report.projects)
      report.phases.total += (bundle.phases ?? []).length
      report.assets.total += (bundle.assets ?? []).length
      countAssetLinksLeftBehind(bundle.assets)
      report.tasks.total  += (bundle.tasks  ?? []).length
      report.files.total  += (bundle.files  ?? []).length
      // FX2 (0096): the items, as the real run will take them.
      for (const it of itemsToCarry(bundle)) {
        report.taskItems.total++
        if (!ITEMS_CARRIED.has(it?.entity_type)) report.taskItems.leftBehind++
      }
      const links = countLinks(bundle.dependencies)
      report.taskLinks.total  += links.task
      report.phaseLinks.total += links.phase
      note(`  ${plural((bundle.phases ?? []).length, 'phase')}, ${plural((bundle.tasks ?? []).length, 'task')}, ` +
           `${plural(links.task, 'task link')}, ${plural(links.phase, 'phase link')}`)
      // S4b (review round 2, R2-BEH-07): the dry run promises what the real
      // run will do with Legal files, asked of the same database.
      const legalCount = (bundle.files ?? []).filter(isLegalFile).length
      if (legalCount > 0) {
        if (legalLocked === null) legalLocked = await cloudLocksLegal()
        report.legalFiles = (report.legalFiles || 0) + legalCount
        note(legalLocked
          ? `  ${plural(legalCount, 'Legal file')} will go to the cloud's locked LEGAL folder`
          : `  ${plural(legalCount, 'Legal file')} will stay on this computer: ${LEGAL_UNAVAILABLE}`)
      }
      // BC3 (B9): what the bins' part will do — counted against what the
      // cloud already holds (a row there is skipped; the rest would be
      // inserted, and a row removed from the cloud since an earlier run is
      // among them: review round 1) — and the question the real run needs
      // answered: each distinct root of the clips, with what the answers
      // given so far make of it.
      const wouldWrite = async (bucket, table, rows) => {
        if (!rows.length) return
        const have = await cloudIds(table, projectId)
        if (have.error) { report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` }); bucket.total += rows.length; return }
        const there = rows.filter(r => have.ids.has(r.id)).length
        bucket.total += rows.length; bucket.skipped += there; bucket.inserted += rows.length - there
      }
      await wouldWrite(report.scenes, 'scenes', bundle.scenes ?? [])
      await wouldWrite(report.shots, 'shots', bundle.shots ?? [])
      await wouldWrite(report.bins, 'bins', bundle.bins ?? [])
      countNotCarried(bundle)
      // M1 (night 3): the project row, then the five kinds as the real run
      // takes them — every row of the bundle taken to land (the dry run
      // writes nothing to fail).
      countProjectLeftAtHome(bundle, !projectThere.there)
      {
        const here = { phases: idSet(bundle.phases), assets: idSet(bundle.assets), tasks: idSet(bundle.tasks), scenes: idSet(bundle.scenes), shots: idSet(bundle.shots), levels: idSet(bundle.levels), experiences: idSet(bundle.experiences) }
        const stateOf = async (table, id) => (here[table]?.has(id) ? 'landed' : 'gone')
        await carryMilestones(bundle, projectId, stateOf, true)
        await carryComments(bundle, projectId, stateOf, true)
        await carryShotLists(bundle, projectId, { scenes: here.scenes, shots: here.shots }, true)
        const folders = await carryFolders(bundle, projectId, (fk, id) => (
          fk === 'level_id' ? (here.levels.has(id) ? 'left' : 'gone')
            : fk === 'experience_id' ? (here.experiences.has(id) ? 'left' : 'gone')
              : here[{ asset_id: 'assets', scene_id: 'scenes', shot_id: 'shots' }[fk]]?.has(id) ? 'landed' : 'gone'
        ), true)
        // The files as the real run will take them: one the cloud holds
        // already is skipped there, filed nowhere (review round 1); one in a
        // folder that did not land waits with it; the rest are filed, and a
        // link to a row this computer removed is let go (review round 2). A
        // file in the cloud's trash is hidden from this read: the real run
        // meets its key and skips it.
        let toCarry = (bundle.files ?? []).filter(isObj)
        if (toCarry.length) {
          const have = await cloudIds('files', projectId)
          if (have.error) report.errors.push({ scope: 'files', projectId, message: `could not read the files already in the cloud: ${have.error.message || have.error}` })
          else toCarry = toCarry.filter(f => !have.ids.has(f.id))
        }
        toCarry = toCarry.filter(f => !folders.failed.has(desktopFolderOfFile(f, bundle.folders)?.id))
        const placeable = toCarry.filter(f => cloudFolderOfFile(f, bundle, folders.cloudOf))
        report.files.placed += placeable.length
        if (placeable.length) note(`  ${FILES_PLACED(placeable.length)}`)
        let letGo = 0
        for (const f of toCarry) for (const [key, table] of Object.entries(FILE_LINKS)) if (named(f[key]) && !here[table].has(f[key])) letGo++
        report.files.linksLetGo += letGo
        if (letGo) note(`  ${FILE_LINKS_LET_GO(letGo)}`)
      }
      if ((bundle.bins ?? []).length || (bundle.binFiles ?? []).length) {
        const clips = bundle.binFiles ?? []
        const roots = binRootsOf(bundle)
        binsState.roots.push({ projectId, roots })
        note(`  ${plural((bundle.bins ?? []).length, 'bin')}, ${plural(clips.length, 'clip')} in ${plural(roots.length, 'footage root')}, ${plural((bundle.shotTakes ?? []).length, 'take')}`)
        const have = clips.length ? await listCloud('bin_files', 'project_id', projectId, 'id, poster_path') : { rows: [] }
        if (have.error) report.errors.push({ scope: 'bin_files', projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` })
        const there = new Map((have.rows || []).map(r => [r.id, r]))
        const named = new Set()
        for (const root of roots) {
          const resolved = await resolveRoot(root)
          const what = resolved.kind === 'existing' ? `the company's "${resolved.location.name}"`
            : resolved.kind === 'new' ? `a new location "${resolved.name}" (${resolved.unc_path})`
              : resolved.kind === 'skip' ? 'left on this computer (not named)'
                : resolved.kind === 'invalid' ? `not an address the cloud takes: ${resolved.problem}`
                  : 'which footage location is this? (not named yet)'
          note(`    ${root.root}: ${plural(root.count, 'clip')} — ${what}`)
          if (resolved.kind === 'existing' || resolved.kind === 'new') { for (const id of root.clipIds) named.add(id); continue }
          report.binFiles.leftBehind += root.count
          for (const id of root.clipIds) {
            const clip = clips.find(f => f.id === id)
            report.clipsLeftBehind.push({ projectId, id, name: clip?.display_name || clip?.original_name || id, root: root.root })
          }
        }
        // A clip with no readable path has no root to ask about: left here, listed.
        const rooted = new Set(roots.flatMap(r => r.clipIds))
        for (const clip of clips) {
          if (rooted.has(clip.id)) continue
          report.binFiles.leftBehind++
          report.clipsLeftBehind.push({ projectId, id: clip.id, name: clip.display_name || clip.original_name || clip.id, root: null })
        }
        for (const clip of clips) {
          if (!named.has(clip.id)) continue
          report.binFiles.total++
          if (there.has(clip.id)) report.binFiles.skipped++; else report.binFiles.inserted++
        }
        // The takes, counted as the real run lands them (review round 2):
        // the live ones only; one in the cloud (by id or by its pair) is
        // skipped; one whose clip goes (or is there) is inserted; one whose
        // clip stays waits with it.
        const liveTakes = liveTakesOf(bundle)
        const haveTakes = liveTakes.length ? await listCloud('shot_takes', 'project_id', projectId, 'id, shot_id, bin_file_id') : { rows: [] }
        if (haveTakes.error) report.errors.push({ scope: 'shot_takes', projectId, message: `could not read what the cloud already holds: ${haveTakes.error.message || haveTakes.error}` })
        const thereTakes = new Set((haveTakes.rows || []).flatMap(t => [t.id, takePairKey(t)]))
        for (const t of liveTakes) {
          report.shotTakes.total++
          if (thereTakes.has(t.id) || thereTakes.has(takePairKey(t))) report.shotTakes.skipped++
          else if (named.has(t.bin_file_id) || there.has(t.bin_file_id)) report.shotTakes.inserted++
          else report.shotTakes.leftBehind++
        }
        // Pictures, for the clips that will go: said now, so the switch is
        // no surprise after the run; one already in the cloud is skipped.
        const withPicture = clips.filter(f => named.has(f.id) && POSTER_MEDIA.has(f.media_type))
        const havePicture = withPicture.filter(f => there.get(f.id)?.poster_path).length
        const toUpload = withPicture.length - havePicture
        report.posters.total += withPicture.length
        report.posters.skipped += havePicture
        if (toUpload > 0) {
          const on = await switchOn()
          if (on) { report.posters.uploaded += toUpload; note(`  ${plural(toUpload, 'picture')} will upload (the company allows viewing from outside the office network)`) }
          else { report.posters.switchOff += toUpload; note(`  ${plural(toUpload, 'picture')}: ${POSTERS_SWITCH_OFF}`) }
        }
      }
      // VW1c (0098): what the views' part will do, counted against what the
      // cloud already holds (a row there is skipped; the rest would be
      // inserted), and what stays.
      const viewsPart = viewsPartOf(bundle)
      if (viewsPart.views.length || viewsPart.carried.length || viewsPart.left.length) {
        countViewsLeftBehind(viewsPart)
        const toCarry = [...viewsPart.views, ...viewsPart.carried]
        const have = toCarry.length ? await cloudViewIds(projectId) : { views: new Set(), groupings: new Set() }
        if (have.absent || have.error) {
          report.errors.push({ scope: 'table_views', projectId, message: have.absent ? TABLE_VIEWS_NOT_IN_CLOUD(viewsPart.views.length, viewsPart.carried.length) : TABLE_VIEWS_UNREAD(have.error.message || have.error) })
          report.tableViews.total += viewsPart.views.length
          report.itemGroupings.total += viewsPart.carried.length
        } else {
          for (const [rows, bucket, there, scope] of [[viewsPart.views, report.tableViews, have.views, 'table_view'], [viewsPart.carried, report.itemGroupings, have.groupings, 'item_grouping']]) {
            for (const row of rows) {
              if (!hasId(row)) { report.errors.push({ scope, projectId, message: NO_ID }); bumpFailed(bucket); continue }
              if (there.has(row.id)) bumpSkipped(bucket); else bumpInserted(bucket)
            }
          }
        }
        note(viewsNote(viewsPart, viewsPart.views.length, viewsPart.carried.length + viewsPart.left.length))
      }
      report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
      continue
    }

    // Project row, through the cloud's columns, in the target workspace
    // (projectRowForCloud, migrationRows.js, says what stays and why).
    //
    // active_shot_list_id stays here (0084; S3a review round 1, scope#9): it
    // names a list not in the cloud yet, so the composite FK
    // projects_active_shot_list_fk refused the whole project (23503) — and
    // its phases, assets and tasks with it. M1 sets it through
    // set_active_shot_list() once the lists are in. Measured on wilson-dev
    // (M1, rolled back): the desktop's `documents` refused the whole row
    // (42703; through PostgREST, PGRST204), so did a locked or open bid
    // version the cloud does not hold (23503) and a folder on this computer
    // (P0001) — every desktop project, until this allowlist.
    let arriving = false
    try {
      const r = await insertOrSkip('projects', projectRowForCloud(bundle.project ?? {}, workspaceId))
      if (r.status === 'inserted') { bumpInserted(report.projects); arriving = true }
      else bumpSkipped(report.projects)
    } catch (err) {
      report.errors.push({ scope: 'project', projectId, message: err.message })
      bumpFailed(report.projects)
      countProjectLeftAtHome(bundle, false)
      continue // don't try children if the project itself failed
    }
    countProjectLeftAtHome(bundle, arriving)

    // M1: which of this project's rows did not land in this run (a comment,
    // a key date or a folder on one fails with it, and a second run brings
    // both), and this project's rows as the cloud shows them, read once per
    // table when a kind needs them: a row whose id another project holds is
    // skipped by its key below, and must never take this project's comment,
    // key date or folder.
    const failedRows = { phases: new Set(), assets: new Set(), tasks: new Set() }
    const here = { phases: idSet(bundle.phases), assets: idSet(bundle.assets), tasks: idSet(bundle.tasks), scenes: idSet(bundle.scenes), shots: idSet(bundle.shots), levels: idSet(bundle.levels), experiences: idSet(bundle.experiences) }
    const cloudRowsOf = new Map()
    const verified = async (table) => {
      if (cloudRowsOf.has(table)) return cloudRowsOf.get(table)
      const r = await cloudIds(table, projectId)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read the project's ${table} in the cloud, so nothing that hangs on them was carried (run again): ${r.error.message || r.error}` })
      cloudRowsOf.set(table, r.error ? null : r.ids)
      return cloudRowsOf.get(table)
    }
    // A row of `table` as this run left it: 'landed' (the cloud shows it
    // under this project), 'failed' (its insert failed in this run),
    // 'unread' (the read of the cloud's rows failed: not known; review round
    // 2 says so apart), 'gone' (removed on this computer — or in the cloud,
    // but not as this project's row: in its trash, or another project's id).
    const stateOf = async (table, id) => {
      if (!here[table]?.has(id)) return 'gone'
      const ids = await verified(table)
      if (!ids) return 'unread'
      if (ids.has(id)) return 'landed'
      return failedRows[table]?.has(id) ? 'failed' : 'gone'
    }

    // Phases / assets / tasks — parent-join-based RLS. assets and tasks
    // auto-populate workspace_id from their project via our 0004 triggers.
    for (const ph of bundle.phases ?? []) {
      try {
        const r = await insertOrSkip('phases', withoutSetAside(ph))
        r.status === 'inserted' ? bumpInserted(report.phases) : bumpSkipped(report.phases)
      } catch (err) {
        report.errors.push({ scope: 'phase', projectId, id: ph.id, message: err.message })
        bumpFailed(report.phases)
        failedRows.phases.add(ph?.id)
      }
    }
    // M1: the key dates, after the phases they may sit in.
    await carryMilestones(bundle, projectId, stateOf, false)
    countAssetLinksLeftBehind(bundle.assets)
    for (const a of bundle.assets ?? []) {
      try {
        const r = await insertOrSkip('assets', assetRowForCloud(a))
        r.status === 'inserted' ? bumpInserted(report.assets) : bumpSkipped(report.assets)
      } catch (err) {
        report.errors.push({ scope: 'asset', projectId, id: a.id, message: err.message })
        bumpFailed(report.assets)
        failedRows.assets.add(a?.id)
      }
    }
    for (const t of bundle.tasks ?? []) {
      try {
        const r = await insertOrSkip('tasks', taskRowForCloud(t))
        r.status === 'inserted' ? bumpInserted(report.tasks) : bumpSkipped(report.tasks)
      } catch (err) {
        report.errors.push({ scope: 'task', projectId, id: t.id, message: err.message })
        bumpFailed(report.tasks)
        failedRows.tasks.add(t?.id)
      }
    }

    // Dependency edges — both tables, after every endpoint row is in.
    // dependencyKind / DEPENDENCY_TABLE route each row to its table exactly
    // as the adapter does on a live link. `kind` and `project_id` are not
    // columns (the desktop URL and the Gantt's arrow routing need them; the
    // database does not) and `predecessor` is the embed a cloud load adds, so
    // all three are stripped BEFORE toColumns, which then has nothing to warn
    // about on a well-formed row. An edge whose endpoint failed above is
    // refused by the foreign key and lands in `errors` with its id — the
    // report says so instead of the Gantt going quietly empty.
    for (const dep of bundle.dependencies ?? []) {
      const kind   = dependencyKind(dep)
      const table  = DEPENDENCY_TABLE[kind]
      const bucket = kind === 'phase' ? report.phaseLinks : report.taskLinks
      try {
        const columns = { ...dep }
        delete columns.kind
        delete columns.project_id
        delete columns.predecessor
        const r = await insertOrSkip(table, toColumns(table, columns))
        r.status === 'inserted' ? bumpInserted(bucket) : bumpSkipped(bucket)
      } catch (err) {
        report.errors.push({ scope: kind === 'phase' ? 'phase_link' : 'task_link', projectId, id: dep.id, message: err.message })
        bumpFailed(bucket)
      }
    }

    // M1: the comments, after every row they can hang on (the project, its
    // phases, assets and tasks).
    await carryComments(bundle, projectId, stateOf, false)

    // ── BC3 (B9): the bins — "bins move with the project" ────────────────
    // Scenes and shots first: a take links a shot to a clip, and a clip may
    // be logged to a scene and a shot, so their rows must be in the cloud
    // before the bins' (the runner carried neither before BC3). Since M1 the
    // shot lists, their items and edits, the folders and the files (each in
    // its folder) come next, before the bins. Then the bins, parents first; then each clip under the
    // footage location its root was named as; then the takes whose shot and
    // clip both landed; then the pictures, while the switch is on. Every
    // row keeps its id (the desktop's UUIDs are 0091's), so a second run
    // skips what is there.
    const landed = { scenes: new Set(), shots: new Set(), bins: new Set(), clips: new Set() }
    // M1 (review round 1, security): the scenes and shots KNOWN to be this
    // project's — inserted now, or skipped while the read of what the cloud
    // holds answered (a duplicate key is then this project's own row). A
    // folder's or a file's scene or shot link is a plain foreign key, so it
    // is kept only to one of these; `landed` also takes a skip made while
    // that read failed, which may be another project's row.
    const landedOurs = { scenes: new Set(), shots: new Set() }
    countNotCarried(bundle)
    // What the cloud already holds for THIS project, per table, so that a
    // duplicate key is "already there" only for this project's own row
    // (review round 2). A read that fails is said; its table then skips a
    // duplicate as before.
    const known = {}
    for (const [key, table] of [['scenes', 'scenes'], ['shots', 'shots'], ['bins', 'bins']]) {
      if (!(bundle[key] ?? []).length) continue
      const r = await cloudIds(table, projectId)
      if (r.error) { known[table] = null; report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds, so a row refused as a duplicate reads as already there: ${r.error.message || r.error}` }) }
      else known[table] = r.ids
    }
    const oursIn = (table) => (known[table] ? (row) => known[table].has(row.id) : null)
    for (const sc of bundle.scenes ?? []) {
      try {
        const r = await insertOrSkip('scenes', toColumns('scenes', withoutSetAside(cloudRowOf(sc, projectId))), oursIn('scenes'))
        r.status === 'inserted' ? bumpInserted(report.scenes) : bumpSkipped(report.scenes)
        landed.scenes.add(sc.id)
        if (r.status === 'inserted' || known.scenes) landedOurs.scenes.add(sc.id)
      } catch (err) {
        report.errors.push({ scope: 'scene', projectId, id: sc.id, message: err.message })
        bumpFailed(report.scenes)
      }
    }
    for (const sh of bundle.shots ?? []) {
      try {
        const row = withoutSetAside(cloudRowOf(sh, projectId))
        // 0040's scene link is a plain FK (no project in it): a scene that
        // did not land here — failed, or another project's — is let go, and
        // said (review round 2, security: a migrated shot must not hang off
        // a scene of another project).
        // M1 review round 2 (security): a scene skipped while the read of the
        // cloud's scenes failed may be another project's, whose delete would
        // take this shot with it (0040's ON DELETE CASCADE); the shot waits —
        // a second run, the read answering, brings it with its scene.
        if (row.scene_id && landed.scenes.has(row.scene_id) && !landedOurs.scenes.has(row.scene_id)) {
          report.errors.push({ scope: 'shot', projectId, id: sh.id, message: `${sh.name || sh.id}: whether its scene is this project's could not be checked (the read of the cloud's scenes failed), so the shot was not carried (a second run brings it)` })
          bumpFailed(report.shots)
          continue
        }
        if (row.scene_id && !landed.scenes.has(row.scene_id)) { report.errors.push({ scope: 'shot', projectId, id: sh.id, message: `${sh.name || sh.id}: its scene is not in the cloud, so the shot's scene link was left empty` }); row.scene_id = null }
        const r = await insertOrSkip('shots', toColumns('shots', row), oursIn('shots'))
        r.status === 'inserted' ? bumpInserted(report.shots) : bumpSkipped(report.shots)
        landed.shots.add(sh.id)
        if (r.status === 'inserted' || known.shots) landedOurs.shots.add(sh.id)
      } catch (err) {
        report.errors.push({ scope: 'shot', projectId, id: sh.id, message: err.message })
        bumpFailed(report.shots)
      }
    }
    // ── M1 (night 3): shot lists with their items and edits, then the
    // folders, after the scenes and shots they name (and the assets) ──────
    await carryShotLists(bundle, projectId, landed, false)
    const folderAssets = (bundle.folders ?? []).some(f => isObj(f) && named(f.asset_id)) ? await verified('assets') : new Set()
    const folders = await carryFolders(bundle, projectId, (fk, id) => {
      if (fk === 'level_id') return here.levels.has(id) ? 'left' : 'gone'
      if (fk === 'experience_id') return here.experiences.has(id) ? 'left' : 'gone'
      if (fk === 'scene_id') return landedOurs.scenes.has(id) ? 'landed' : here.scenes.has(id) ? 'failed' : 'gone'
      if (fk === 'shot_id') return landedOurs.shots.has(id) ? 'landed' : here.shots.has(id) ? 'failed' : 'gone'
      if (fk === 'asset_id') return !here.assets.has(id) ? 'gone' : !folderAssets ? 'unread' : folderAssets.has(id) ? 'landed' : failedRows.assets.has(id) ? 'failed' : 'gone'
      return 'gone'
    }, false)
    // A file's own links (0000's phase, asset and task; 0043's scene and
    // shot) are plain foreign keys, with no project in them. Each is kept
    // only to a row the cloud holds as this project's; a row of this project
    // that did not land in this run fails the file with it, before a byte
    // moves (a second run brings both); a row removed on this computer (the
    // desktop's deletes leave a file's link) or not this project's is let go,
    // counted and said (review round 1, security, and a run that could never
    // be Done: before, such a file was refused on every run).
    const fileLinkState = async (key, id) => {
      if (key === 'scene_id') return landedOurs.scenes.has(id) ? 'landed' : here.scenes.has(id) ? 'failed' : 'gone'
      if (key === 'shot_id') return landedOurs.shots.has(id) ? 'landed' : here.shots.has(id) ? 'failed' : 'gone'
      return stateOf(FILE_LINKS[key], id)
    }

    // Files — upload the binary, then the metadata row (which gets the
    // cloud storage_path). Since M1 after the folders: each row is filed in
    // the folder the desktop shows it in (cloudFolderOfFile), and after the
    // scenes and shots, which a file's own links may name.
    let placed = 0
    let linksLetGo = 0
    for (const f of bundle.files ?? []) {
      try {
        // S4b: a Legal file (on the desktop, its tag) goes under LEGAL with
        // its tag, never core — or, where the cloud does not lock LEGAL, not
        // at all. Decided BEFORE its body is read.
        const legal = isLegalFile(f)
        if (legal) {
          if (legalLocked === null) legalLocked = await cloudLocksLegal()
          if (!legalLocked) {
            report.errors.push({ scope: 'file', projectId, id: f.id, message: `Legal file not migrated: ${LEGAL_UNAVAILABLE}` })
            bumpSkipped(report.files)
            continue
          }
        }
        const objectPath = cloudObjectPathFor(projectId, f)
        const asked = await cloudFileRow(f.id)
        if (asked.error) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `could not check whether the file is already in the cloud: ${asked.error.message || asked.error}` })
          bumpFailed(report.files)
          continue
        }
        const already = asked.row
        if (already) {
          if (already.storage_path && already.storage_path !== objectPath) {
            report.errors.push({
              scope: 'file', projectId, id: f.id,
              message: `already in the cloud at an older path (${already.storage_path}), not uploaded again — check that copy, and add the file again if it is wrong`,
            })
          }
          bumpSkipped(report.files)
          continue
        }
        const links = {}
        let blocked = null
        for (const key of Object.keys(FILE_LINKS)) {
          // A cleared picker's '' is no link (the UUID column refuses it).
          if (f[key] === '') { links[key] = null; continue }
          if (!named(f[key])) continue
          const st = await fileLinkState(key, f[key])
          if (st === 'failed' || st === 'unread') { blocked = { what: key.replace(/_id$/, ''), unread: st === 'unread' }; break }
          if (st === 'gone') links[key] = null
        }
        if (blocked) {
          report.errors.push({
            scope: 'file', projectId, id: f.id,
            message: blocked.unread
              ? `${f.name || f.id}: whether its ${blocked.what} is in the cloud could not be checked (the read failed), so the file was not carried (run again)`
              : `${f.name || f.id}: its ${blocked.what} is not in the cloud, so the file was not carried (a second run brings both)`,
          })
          bumpFailed(report.files)
          continue
        }
        // Its folder (review round 2): one that did not land in this run
        // keeps the file with it, as a row the file is about does.
        if (folders.failed.has(desktopFolderOfFile(f, bundle.folders)?.id)) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `${f.name || f.id}: its folder is not in the cloud, so the file was not carried (a second run brings both)` })
          bumpFailed(report.files)
          continue
        }
        const { blob, status } = await fetchLocalFileBlob(projectId, f.id)
        if (!blob) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `the file's body could not be read on this computer (HTTP ${status})` })
          bumpFailed(report.files)
          continue
        }

        const objectDir = objectPath.slice(0, objectPath.lastIndexOf('/'))
        const safeName = objectPath.slice(objectPath.lastIndexOf('/') + 1)

        // Detect already-uploaded objects via list (cheap for the dir).
        const { data: existing } = await supabase.storage
          .from('rabbit-files')
          .list(objectDir, { limit: 10 })
        const alreadyUploaded = existing?.some(e => e.name === safeName)

        if (!alreadyUploaded) {
          const { error: upErr } = await supabase.storage
            .from('rabbit-files')
            .upload(objectPath, blob, {
              cacheControl: '3600',
              upsert: false,
              contentType: f.mime_type || blob.type || 'application/octet-stream',
            })
          if (upErr && !/already exists/i.test(upErr.message)) {
            throw new Error(`storage upload: ${upErr.message}`)
          }
          report.files.bytes += blob.size ?? 0
        }

        const row = {
          ...f,
          ...links,
          storage_provider: 'supabase',
          storage_path:     objectPath,
          // M1: the folder in the cloud, never the desktop's own id.
          folder_id:        cloudFolderOfFile(f, bundle, folders.cloudOf),
        }
        if (legal) {
          row.tags = ['legal', ...(Array.isArray(f.tags) ? f.tags.filter(t => t !== 'legal') : [])]
          row.is_core_definer = false // files_legal_not_core_chk
        } else if (Array.isArray(f.tags) && f.tags.includes('legal')) {
          row.tags = f.tags.filter(t => t !== 'legal') // not Legal: a label only
        }
        const r = await insertOrSkip('files', row)
        r.status === 'inserted' ? bumpInserted(report.files) : bumpSkipped(report.files)
        if (r.status === 'inserted' && row.folder_id) placed++
        if (r.status === 'inserted') linksLetGo += Object.entries(links).filter(([k]) => f[k] !== '').length
      } catch (err) {
        report.errors.push({ scope: 'file', projectId, id: f.id, message: err.message })
        bumpFailed(report.files)
      }
    }
    report.files.placed += placed
    if (placed) note(`  ${FILES_PLACED(placed)}`)
    report.files.linksLetGo += linksLetGo
    if (linksLetGo) note(`  ${FILE_LINKS_LET_GO(linksLetGo)}`)

    for (const b of binsParentsFirst(bundle.bins ?? [])) {
      try {
        const r = await insertOrSkip('bins', toColumns('bins', { ...cloudRowOf(b, projectId), workspace_id: workspaceId }), oursIn('bins'))
        r.status === 'inserted' ? bumpInserted(report.bins) : bumpSkipped(report.bins)
        landed.bins.add(b.id)
      } catch (err) {
        report.errors.push({ scope: 'bin', projectId, id: b.id, message: err.message })
        bumpFailed(report.bins)
      }
    }
    const clips = bundle.binFiles ?? []
    const roots = binRootsOf(bundle)
    if (clips.length) binsState.roots.push({ projectId, roots })
    const rootByClip = new Map()
    for (const root of roots) for (const id of root.clipIds) rootByClip.set(id, root)
    // What the cloud already holds for this project (a second run): the
    // rows to skip, and which of them still want a picture.
    let cloudClips = new Map()
    // The read failed: the rows still go (a row already there is skipped by
    // its key), but no picture does — which rows already have one is
    // unknown, and a second upload would orphan the first in the bucket.
    let cloudClipsUnknown = false
    if (clips.length) {
      const have = await listCloud('bin_files', 'project_id', projectId, 'id, poster_path, location_id')
      if (have.error) { cloudClipsUnknown = true; report.errors.push({ scope: 'bin_files', projectId, message: `could not read the project's clips already in the cloud, so no picture was uploaded for it: ${have.error.message || have.error}` }) }
      else cloudClips = new Map(have.rows.map(r => [r.id, r]))
    }
    const wantPicture = []
    const leftClips = new Set()
    // A clip already in the cloud keeps the location it has there: the
    // answer given now does not move it. Said once per root (review round 2:
    // the answer used to make an empty location for clips all already there).
    const keptLocation = new Map()
    for (const clip of clips) {
      const root = rootByClip.get(clip.id)
      const name = clip.display_name || clip.original_name || clip.id
      if (!root) {
        // No readable path: left here, listed (never dropped), with its reason.
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: no path recorded, so it was left on this computer` })
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: null })
        leftClips.add(clip.id)
        continue
      }
      let resolved
      try { resolved = await resolveRoot(root) } catch (err) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: err.message }); bumpFailed(report.binFiles); continue }
      if (resolved.kind !== 'existing' && resolved.kind !== 'new') {
        // Not named: left here, listed, never dropped. The desktop's bundle
        // is untouched, and a second run after naming the root brings it.
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: root.root })
        leftClips.add(clip.id)
        continue
      }
      try {
        // Already in the cloud (a second run): skipped BEFORE any location
        // is made for it, and its picture completed if it still has none.
        const already = cloudClips.get(clip.id)
        if (already) {
          const namedId = resolved.kind === 'existing' ? resolved.location.id : resolved.location?.id
          if (already.location_id && already.location_id !== namedId) keptLocation.set(root.key, (keptLocation.get(root.key) || 0) + 1)
          bumpSkipped(report.binFiles)
          landed.clips.add(clip.id)
          if (POSTER_MEDIA.has(clip.media_type) && !already.poster_path && !cloudClipsUnknown) wantPicture.push(clip)
          else if (POSTER_MEDIA.has(clip.media_type)) { report.posters.total++; report.posters.skipped++ }
          continue
        }
        if (!landed.bins.has(clip.bin_id)) throw new Error(`its bin (${clip.bin_id}) is not in the cloud`)
        // The row is built BEFORE a location is made for it (review round
        // 1): a clip the cloud cannot take leaves no empty location behind.
        const made = cloudBinFileRow(clip, { root: root.root, locationId: null, prefix: resolved.prefix, workspaceId, projectId })
        if (made.error) throw new Error(made.error)
        const row = made.row
        row.location_id = await locationIdFor(resolved)
        // A scene or shot link to a row that did not land is let go, and said.
        if (row.scene_id && !landed.scenes.has(row.scene_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its scene is not in the cloud, so the clip's scene link was left empty` }); row.scene_id = null }
        if (row.shot_id && !landed.shots.has(row.shot_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its shot is not in the cloud, so the clip's shot link was left empty` }); row.shot_id = null }
        const r = await insertOrSkip('bin_files', toColumns('bin_files', row), cloudClipsUnknown ? null : (x) => cloudClips.has(x.id))
        r.status === 'inserted' ? bumpInserted(report.binFiles) : bumpSkipped(report.binFiles)
        landed.clips.add(clip.id)
        if (POSTER_MEDIA.has(clip.media_type) && !cloudClipsUnknown) wantPicture.push(clip)
        else if (POSTER_MEDIA.has(clip.media_type)) { report.posters.total++; report.posters.skipped++ }
      } catch (err) {
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: ${err.message}` })
        bumpFailed(report.binFiles)
      }
    }
    for (const [key, n] of keptLocation) {
      const root = roots.find(r => r.key === key)
      note(`  ${root?.root || key}: ${plural(n, 'clip')} already in the cloud ${n === 1 ? 'keeps' : 'keep'} the footage location ${n === 1 ? 'it has' : 'they have'} there (the answer given now moves no clip)`)
    }
    // The takes: the live ones (a take of a shot or clip removed on this
    // computer is the desktop's own, for undo: not carried, not an error)
    // whose shot and clip landed, their role and position settled against
    // the takes the cloud already holds for the shot (takesToLand): one
    // already there is skipped without a write; a take of a clip left on
    // this computer waits with it (left behind, not failed); a take whose
    // shot or clip FAILED is said.
    const takes = liveTakesOf(bundle)
    let cloudTakes = []
    let cloudTakesUnknown = false
    if (takes.length) {
      const have = await listCloud('shot_takes', 'project_id', projectId, 'id, shot_id, bin_file_id, role, position')
      if (have.error) { cloudTakesUnknown = true; report.errors.push({ scope: 'shot_takes', projectId, message: `could not read the project's takes already in the cloud, so a duplicate reads as already there: ${have.error.message || have.error}` }) }
      else cloudTakes = have.rows
    }
    const thereTakes = new Set(cloudTakes.flatMap(t => [t.id, takePairKey(t)]))
    const landing = takesToLand(takes, landed.shots, landed.clips, cloudTakes)
    const landingIds = new Set(landing.map(t => t.id))
    for (const t of takes) {
      if (landingIds.has(t.id)) continue
      report.shotTakes.total++
      if (thereTakes.has(t.id) || thereTakes.has(takePairKey(t))) { report.shotTakes.skipped++; continue }
      if (leftClips.has(t.bin_file_id)) { report.shotTakes.leftBehind++; continue }
      const why = !landed.shots.has(t.shot_id) ? 'its shot is not in the cloud' : 'its clip is not in the cloud'
      report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: `take not migrated: ${why}` })
      report.shotTakes.failed++
    }
    for (const t of landing) {
      report.shotTakes.total++
      const was = takes.find(x => x.id === t.id)
      if (was?.role === 'primary' && t.role !== 'primary') {
        const clip = clips.find(c => c.id === t.bin_file_id)
        note(`  ${clip?.display_name || clip?.original_name || t.bin_file_id}: lands as an alternative take — its shot already has a primary take in the cloud`)
      }
      try {
        const r = await insertOrSkip('shot_takes', toColumns('shot_takes', { ...cloudRowOf(t, projectId), workspace_id: workspaceId }), cloudTakesUnknown ? null : (x) => thereTakes.has(x.id) || thereTakes.has(takePairKey(x)))
        r.status === 'inserted' ? report.shotTakes.inserted++ : report.shotTakes.skipped++
      } catch (err) {
        report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: err.message })
        report.shotTakes.failed++
      }
    }
    // FX2 (0096): a task's items, after every row they can name is in — the
    // tasks and assets (above), the scenes and shots (BC3, above). VW1m
    // (2026-10-16): every one, its assets included, lands here (the task
    // went up without its links, taskRowForCloud) and 0097 §4 writes the
    // cloud's copy from them; every item keeps its id and position. An item
    // the cloud has already (a move run again) answers 23505 and reads as
    // skipped; one whose asset did not go up fails alone, in the report. Levels and
    // experiences are not carried, so their items stay on this computer and
    // are counted.
    for (const it of itemsToCarry(bundle)) {
      report.taskItems.total++
      if (!ITEMS_CARRIED.has(it?.entity_type)) { report.taskItems.leftBehind++; continue }
      try {
        const r = await insertOrSkip('task_items', toColumns('task_items', {
          ...(it.id != null ? { id: it.id } : {}), task_id: it.task_id, project_id: projectId,
          entity_type: it.entity_type, entity_id: it.entity_id,
          position: Number.isInteger(it.position) && it.position >= 0 ? it.position : 0,
          ...(it.created_at ? { created_at: it.created_at } : {}),
        }))
        r.status === 'inserted' ? report.taskItems.inserted++ : report.taskItems.skipped++
      } catch (err) {
        report.errors.push({ scope: 'task_item', projectId, id: it.id, message: err.message })
        report.taskItems.failed++
      }
    }
    // VW1c (0098): the project's saved views and groupings, with their ids,
    // after every row a grouping can name is in (the assets above, BC3's
    // scenes and shots). By INSERT through the cloud adapter (addTableView /
    // addItemGrouping): never an upsert, its column allowlist strips the
    // workspace, the revision and the stamps, which the cloud makes its own
    // (each view takes a new revision there, made by whoever runs the move).
    // What the cloud holds of the project is read first, so a second run
    // skips by id; a grouping whose set the cloud holds under another id (a
    // teammate made it) is skipped too — the cloud answers that row. A
    // grouping of levels or experiences stays (the runner carries neither),
    // counted, as are the views that filter by one. A cloud without 0098, or
    // a read that fails, writes none of the project's and says so once; they
    // count as failed, so the panel does not call the run done, and a later
    // run brings them.
    const viewsPart = viewsPartOf(bundle)
    if (viewsPart.views.length || viewsPart.carried.length || viewsPart.left.length) {
      countViewsLeftBehind(viewsPart)
      const toCarry = [...viewsPart.views, ...viewsPart.carried]
      const have = toCarry.length ? await cloudViewIds(projectId) : { views: new Set(), groupings: new Set() }
      let viewsThere = 0
      let groupingsThere = 0
      if (have.absent || have.error) {
        report.errors.push({ scope: 'table_views', projectId, message: have.absent ? TABLE_VIEWS_NOT_IN_CLOUD(viewsPart.views.length, viewsPart.carried.length) : TABLE_VIEWS_UNREAD(have.error.message || have.error) })
        report.tableViews.total += viewsPart.views.length
        report.tableViews.failed += viewsPart.views.length
        report.itemGroupings.total += viewsPart.carried.length
        report.itemGroupings.failed += viewsPart.carried.length
      } else {
        for (const v of viewsPart.views) {
          if (!hasId(v)) { report.errors.push({ scope: 'table_view', projectId, message: NO_ID }); bumpFailed(report.tableViews); continue }
          if (have.views.has(v.id)) { bumpSkipped(report.tableViews); viewsThere++; continue }
          try {
            await viewsAdapter.addTableView({ id: v.id, project_id: projectId, table_key: v.table_key, name: v.name, position: v.position, config: v.config })
            bumpInserted(report.tableViews)
            viewsThere++
          } catch (err) {
            report.errors.push({ scope: 'table_view', projectId, id: v.id, message: viewWriteMessage('table_views', err) })
            bumpFailed(report.tableViews)
          }
        }
        for (const g of viewsPart.carried) {
          if (!hasId(g)) { report.errors.push({ scope: 'item_grouping', projectId, message: NO_ID }); bumpFailed(report.itemGroupings); continue }
          if (have.groupings.has(g.id)) { bumpSkipped(report.itemGroupings); groupingsThere++; continue }
          try {
            const stored = await viewsAdapter.addItemGrouping({ id: g.id, project_id: projectId, table_key: g.table_key, kind: g.kind, entity_ids: g.entity_ids })
            if (stored && stored.id !== g.id) bumpSkipped(report.itemGroupings)
            else bumpInserted(report.itemGroupings)
            groupingsThere++
          } catch (err) {
            report.errors.push({ scope: 'item_grouping', projectId, id: g.id, message: viewWriteMessage('item_groupings', err) })
            bumpFailed(report.itemGroupings)
          }
        }
      }
      note(viewsNote(viewsPart, viewsThere, groupingsThere, ' in the cloud'))
    }
    // Pictures: only while the company's switch is on (B4) — asked once;
    // off, the desktop keeps them and the report says so. The desktop makes
    // each picture on demand from the file it reaches; a clip it cannot
    // reach has none to send, which is said per clip.
    if (wantPicture.length) {
      report.posters.total += wantPicture.length
      const on = await switchOn()
      if (!on) {
        report.posters.switchOff += wantPicture.length
        note(`  ${plural(wantPicture.length, 'picture')}: ${POSTERS_SWITCH_OFF}`)
      } else {
        let done = 0
        for (const clip of wantPicture) {
          const name = clip.display_name || clip.original_name || clip.id
          try {
            const { bytes, why } = await fetchLocalPoster(projectId, clip.id)
            if (!bytes) throw new Error(`no picture on this computer (${why})`)
            await uploadPoster(projectId, clip.id, bytes)
            report.posters.uploaded++
          } catch (err) {
            report.errors.push({ scope: 'poster', projectId, id: clip.id, message: `${name}: ${err.message}` })
            report.posters.failed++
          }
          done++
          if (done % 10 === 0 || done === wantPicture.length) note(`  Pictures: ${done} of ${wantPicture.length}`)
        }
      }
    }
    if (clips.length) {
      const left = report.clipsLeftBehind.filter(c => c.projectId === projectId).length
      const takesThere = landing.length + takes.filter(t => !landingIds.has(t.id) && (thereTakes.has(t.id) || thereTakes.has(takePairKey(t)))).length
      note(`  ${plural(report.bins.inserted + report.bins.skipped, 'bin')}, ${plural(landed.clips.size, 'clip')} and ${plural(takesThere, 'take')} in the cloud` +
        (left ? `; ${BINS_LEFT_BEHIND(left)}` : ''))
    }
  }

  report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
  report.notCarried = [...notCarried.values()]
  report.finishedAt = new Date().toISOString()
  return report
}
