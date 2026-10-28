// =============================================================================
// migrationRows.js — the rows the desktop → cloud migration carries beyond
// the bins (M1, night 3 of docs/sessions/PLAN_TO_1_0.md): a project's key
// dates, its comments, its shot lists with their items and edits, its folder
// tree — and the project row itself, through the cloud's columns.
//
// Pure (no network, no React), beside runMigration.js as binsMigration.js is,
// so every rule is pinned without a client: the row each desktop shape
// becomes (an allowlist per table — one key the cloud does not have refuses
// the whole row), the orders the cloud's keys need (an edit after its
// parent, a folder after its parent), and the folder the desktop shows a
// file in, which is where the cloud files it.
//
// Measured on wilson-dev (2026-10-27, each a rolled-back INSERT; the M1
// hand-off quotes every response): a desktop project row is refused whole
// for `documents` (42703: none of documents, visualAssets, files_dir is a
// column), for a locked or an open bid version the cloud does not have
// (23503: projects_budget_active_version_id_fkey, projects_open_budget_
// version_fk), and for its folder on this computer (P0001,
// fn_project_folder_root_guard: an admin's or a manager's, inside the
// company's storage drive, or none); a comment for `project_id` (42703); a
// milestone for `name` (42703, the fixtures carry it); a shot list or an
// edit that arrives archived (42501, 0084's guard); an edit before its parent
// (23503); a level's folder while levels stayed on this computer (23503).
//
// M2 (night 4) adds part 2's rows — a project's bid versions, budget lines,
// actuals, expenses and rate overrides, its levels and experiences, the
// links on its tasks — and the record of what each run carried (the second
// run's). Measured on wilson-dev (2026-10-28, rolled back; the M2 hand-off
// quotes every response): a version naming a shot list the cloud does not
// hold (23503 budget_versions_shot_list_fk), with no name (23502) or a type
// outside bid, actual, final (23514); a section header's null rate (23502)
// and a cleared number, '' (22P02); an actual's source outside manual,
// timecard, expense (23514: the fixtures' invoice and timesheet) and its line
// not there (23503); an expense's '' purchase date (22007) and a null array
// (23502); a rate override naming both a role and a person (23514); a level
// with the older add's `files` key (42703) or a null status (23502); a link
// on a task carrying `project_id` (42703); an asset naming a task template
// the cloud does not hold (23503 assets_task_template_id_fkey).
// =============================================================================

import { COLUMN_ALLOWLIST } from '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter'
import { isLegalFile } from '../../tools/rabbit_v0.1.0/fileTags'
import { toIsoDate } from '../../tools/rabbit_v0.1.0/dates'

const isRow = (r) => r != null && typeof r === 'object' && !Array.isArray(r)
const named = (v) => v != null && v !== ''
const without = (set, keys) => new Set([...set].filter(k => !keys.includes(k)))

/** Only `allow`'s keys, silently: a desktop key the cloud lacks is expected here, and each is named where its table's set is made. */
function onlyColumns(row, allow) {
  const out = {}
  if (!isRow(row)) return out
  for (const [k, v] of Object.entries(row)) if (allow.has(k)) out[k] = v
  return out
}

/** A column that is NOT NULL with a default refuses an explicit null (23502): leave the key out, so the default applies. */
function dropNulls(row, keys) {
  for (const k of keys) if (k in row && row[k] == null) delete row[k]
  return row
}

// A day as a DATE column stores it. A string that starts with a day keeps
// that day, whatever time or offset follows, as Postgres's own DATE input
// does (measured on wilson-dev, review round 2: '2026-12-01T00:00:00.000Z'
// and '2026-12-01T23:30:00-05:00' are both 2026-12-01) — R.A.B.B.I.T.'s
// settings store a picked day as that day's midnight in UTC, and the desktop
// shows its first ten characters, while a local reading puts it on the day
// before west of Greenwich. Any other spelling is read by dates.js's
// toIsoDate. null: no day (30 February is none).
const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/
export function cloudDay(v) {
  if (!named(v)) return null
  const m = typeof v === 'string' ? DAY_PREFIX.exec(v.trim()) : null
  return toIsoDate(m ? m[1] : v)
}

// ── The project row ─────────────────────────────────────────────────────────

/**
 * The project's own keys that the cloud row does not take from the file:
 *   - its active shot list: set through set_active_shot_list() once its lists
 *     are in (0084: the pointer's composite foreign key, and the guard that
 *     reserves it for that function);
 *   - its locked and open bid versions: both foreign keys refuse an id the
 *     cloud does not hold, and with it the whole project (measured), so the
 *     runner sets them by UPDATE once this run has carried the versions
 *     (M2), each only to a version of this project;
 *   - its folder on this computer: the cloud takes a project folder only from
 *     an admin or a manager, inside the company's storage drive (measured: no
 *     seat, or no drive, refuses the whole project) — and a path on one
 *     computer is no address for a teammate's;
 *   - who the file says made or changed it: the cloud stamps the signed-in
 *     person (fn_audit_touch), who is then the project's manager
 *     (fn_projects_auto_staff) — cloudRowOf's rule (binsMigration.js).
 * Every other column of PROJECT_COLUMNS goes up, and `folder_slug` too (a
 * column since 0041 that the cloud adapter never writes: the desktop's is the
 * name of the folder the project's tree was planned from). `documents`,
 * `visualAssets` and `files_dir` are no columns at all: the deck attachments
 * move by Settings' "Move deck attachments into project files", and the files
 * folder is this computer's.
 */
export const PROJECT_LEFT_AT_HOME = Object.freeze([
  'active_shot_list_id', 'budget_active_version_id', 'open_budget_version_id', 'folder_root',
  'created_by', 'updated_by', 'last_updated_by', 'deleted_by',
])
const PROJECT_ROW_COLUMNS = without(new Set([...COLUMN_ALLOWLIST.projects, 'folder_slug']), PROJECT_LEFT_AT_HOME)

/**
 * The cloud's `project_status` values: 0000's five and, since 0103 (M2,
 * Audrey's ruling of 2026-10-28), the desktop's `draft` and `wrapped` (the
 * project's settings) and `inactive` (the Projects page), so a project keeps
 * its own. A cloud without 0103 refuses those three (22P02, measured) — and
 * with them the whole project; the runner then sends the row again without
 * its status and says so (STATUS_NOT_IN_CLOUD).
 */
export const CLOUD_PROJECT_STATUSES = Object.freeze(['draft', 'active', 'on_hold', 'inactive', 'wrapped', 'completed', 'archived', 'cancelled'])
// Columns that are NOT NULL with a default (read on wilson-dev): an explicit
// null refuses the whole row (23502) — a cleared frame rate is stored null —
// so it is left out and the default applies.
const PROJECT_DEFAULTED = [
  'status', 'created_at', 'updated_at', 'budget_margin_pct', 'budget_contingency_pct', 'budget_agency_pct',
  'budget_agency_enabled', 'budget_actual_column_mode', 'budget_actual_column_count', 'budget_active',
  'budget_finalized', 'scene_separator', 'scene_digits', 'shot_digits', 'scene_start_number', 'fps',
  'scenes_enabled', 'levels_enabled', 'experiences_enabled', 'uses_realtime_engine', 'is_private',
]
const PROJECT_NUMBERS = ['budget_total', 'budget_margin_pct', 'budget_contingency_pct', 'budget_agency_pct', 'budget_actual_column_count', 'scene_digits', 'shot_digits', 'scene_start_number', 'fps']
const PROJECT_INTEGERS = ['budget_actual_column_count', 'scene_digits', 'shot_digits', 'scene_start_number']
// The NUMERIC columns' room (0000's budget_total NUMERIC(12,2), 0036's
// percentages NUMERIC(7,3), 0040's fps NUMERIC(6,2)) and INTEGER's: a value
// past it overflows (22003) and refused the whole project (review round 2).
const PROJECT_BOUNDS = { budget_total: 9999999999.995, budget_margin_pct: 9999.9995, budget_contingency_pct: 9999.9995, budget_agency_pct: 9999.9995, fps: 9999.995 }
const INT_MAX = 2147483647
const PROJECT_DATES = [['start_date', 'startDate'], ['end_date', 'endDate']]
// A person's id (0020: UUID, no foreign key, nullable).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The words the project's settings give each value (ProjectSummaryView.jsx),
// for the report's line on the ones the cloud cannot hold.
const PROJECT_VALUE_WORDS = {
  start_date: 'start date', end_date: 'end date', budget_total: 'targeted budget total',
  budget_margin_pct: 'margin %', budget_contingency_pct: 'contingency %', budget_agency_pct: 'agency %',
  budget_actual_column_mode: 'actuals column mode', budget_actual_column_count: 'number of columns',
  scene_digits: 'scene digits', shot_digits: 'shot digits', scene_start_number: 'numbering start',
  fps: 'frames per second', producer_id: 'producer', director_id: 'director',
}

/**
 * A desktop project row as the cloud's `projects` takes it, in the target
 * workspace — its columns (above), and values each column's type and checks
 * take, as the cloud adapter's own writes shape them (mapDogProjectFields):
 *   - the dates: D.O.G.'s new-project window writes `startDate` / `endDate`
 *     alone (the desktop's POST leaves `start_date` empty), R.A.B.B.I.T.'s
 *     settings later write `start_date` alone, the Projects page both — so
 *     the column's own value wins, then D.O.G.'s (review round 2). A cleared
 *     field is '' (a DATE refuses it, 22007). Each goes up as the day a DATE
 *     column stores (cloudDay) or nothing;
 *   - a status the cloud does not have, '' included, is left out, so the
 *     cloud's default (active) applies; projectLeftAtHome names it;
 *   - a null where the column has a default, an empty or non-numeric number,
 *     a number past its column's room, a fraction in a whole-number column, a
 *     negative percentage, an actuals mode or column count outside the
 *     budget settings' checks (0036): left out, so the default applies;
 *   - a producer or director that is no id (a cleared picker stores '', which
 *     the UUID column refuses, 22P02 — measured): empty;
 *   - no title (the column has no default): the desktop's own word for one.
 * projectValuesLeftOut names the values a person set that do not go up.
 */
export function projectRowForCloud(project, workspaceId) {
  const p = isRow(project) ? project : {}
  const row = onlyColumns(p, PROJECT_ROW_COLUMNS)
  for (const [col, dog] of PROJECT_DATES) {
    const day = cloudDay(p[col]) ?? cloudDay(p[dog])
    if (day) row[col] = day
    else if (col in row || dog in p) row[col] = null
  }
  // '' too: the type refuses it as it does a word it lacks (22P02).
  if ('status' in row && !CLOUD_PROJECT_STATUSES.includes(row.status)) delete row.status
  for (const k of PROJECT_NUMBERS) if (k in row && row[k] != null && (row[k] === '' || !Number.isFinite(Number(row[k])))) delete row[k]
  for (const [k, room] of Object.entries(PROJECT_BOUNDS)) if (row[k] != null && !(Math.abs(Number(row[k])) < room)) delete row[k]
  // INTEGER columns (0040, 0036) refuse a fraction (22P02) and a number past INTEGER's room (22003).
  for (const k of PROJECT_INTEGERS) if (row[k] != null && !(Number.isInteger(Number(row[k])) && Math.abs(Number(row[k])) <= INT_MAX)) delete row[k]
  for (const k of ['budget_margin_pct', 'budget_contingency_pct', 'budget_agency_pct']) if (row[k] != null && Number(row[k]) < 0) delete row[k]
  for (const k of ['producer_id', 'director_id']) if (k in row && row[k] != null && !UUID.test(String(row[k]))) row[k] = null
  if (row.budget_actual_column_mode != null && !['fortnightly', 'weekly', 'count'].includes(row.budget_actual_column_mode)) delete row.budget_actual_column_mode
  if (row.budget_actual_column_count != null) {
    const n = Number(row.budget_actual_column_count)
    if (!(Number.isInteger(n) && n >= 1 && n <= 104)) delete row.budget_actual_column_count
  }
  dropNulls(row, PROJECT_DEFAULTED)
  if (!named(row.title)) row.title = 'Untitled Project'
  row.workspace_id = workspaceId
  return row
}

/**
 * The values a person set on the project that its cloud row leaves out
 * (projectRowForCloud), in the settings' own words, the status apart (it has
 * its own line). A field left empty is no value: a cleared picker's '' and a
 * null are not named.
 */
export function projectValuesLeftOut(project) {
  const p = isRow(project) ? project : {}
  const row = projectRowForCloud(p, null)
  const out = []
  for (const [col, dog] of PROJECT_DATES) if ((named(p[col]) || named(p[dog])) && row[col] == null) out.push(PROJECT_VALUE_WORDS[col])
  for (const col of [...PROJECT_NUMBERS, 'budget_actual_column_mode', 'producer_id', 'director_id']) {
    if (named(p[col]) && row[col] == null) out.push(PROJECT_VALUE_WORDS[col])
  }
  return out
}

/** What the project row leaves on this computer that the report names: its folder, a status the cloud does not have, the values it cannot hold, its deck attachments not yet moved. (Its bid version pointers are set after its versions, M2.) */
export function projectLeftAtHome(project) {
  const p = isRow(project) ? project : {}
  const count = (k) => (Array.isArray(p[k]) ? p[k].length : 0)
  return {
    folder: named(p.folder_root),
    status: named(p.status) && !CLOUD_PROJECT_STATUSES.includes(p.status) ? String(p.status) : null,
    values: projectValuesLeftOut(p),
    deckAttachments: count('documents') + count('visualAssets'),
  }
}

// ── Milestones (0067) ───────────────────────────────────────────────────────

// The editor's columns and the spine; not workspace_id (stamped from the
// project), not who made it, not deleted_at (a trashed row is not carried:
// the cloud's trash is its own) nor set_aside_at (a set-aside row arrives
// live, as phases and tasks do; M2 sets it aside again once its open bid
// version is in, through 0090's set_aside_schedule_rows()). Not `name`, which
// the fixtures carry beside `title` (42703, measured).
const MILESTONE_ROW_COLUMNS = without(COLUMN_ALLOWLIST.milestones, ['workspace_id', 'created_by', 'updated_by'])

/** A desktop milestone as the cloud's `milestones` takes it. */
export function milestoneRowForCloud(m, projectId) {
  const row = onlyColumns(m, MILESTONE_ROW_COLUMNS)
  row.project_id = projectId
  // A DATE column refuses '' (22007): an editor that cleared the field sends
  // it. A day goes up as the column stores one (cloudDay).
  if ('date' in row) row.date = cloudDay(row.date)
  // A cleared phase picker's '' is no phase (the UUID column refuses it).
  if (row.phase_id === '') row.phase_id = null
  return dropNulls(row, ['sort_order', 'created_at', 'updated_at'])
}

// ── Comments (0000) ─────────────────────────────────────────────────────────

/** The rows a cloud comment can hang on (0000's CHECK), and the table each is in. */
export const COMMENT_TARGETS = Object.freeze({ project: 'projects', phase: 'phases', asset: 'assets', task: 'tasks' })

// The cloud's columns less what the cloud stamps (workspace_id from the row
// it hangs on, the audit and trash columns) and less who the file says wrote
// it (author_user_id: a claim this computer cannot prove — cloudRowOf's rule;
// the author's name, which the desktop shows, goes up). NOT project_id: the
// desktop stamps one and the cloud has no such column (42703, measured).
const COMMENT_ROW_COLUMNS = new Set(['id', 'entity_type', 'entity_id', 'body', 'author_name', 'created_at', 'updated_at'])

/** A desktop comment as the cloud's `comments` takes it. */
export function commentRowForCloud(c) {
  return dropNulls(onlyColumns(c, COMMENT_ROW_COLUMNS), ['created_at', 'updated_at'])
}

// ── Shot lists, their items, edits (0084) ───────────────────────────────────

// Never sent: workspace_id (stamped), who made it (0086 pins the maker to
// the signed-in person), and the archive columns (a row arrives live; only
// archive_shot_list() / archive_edit() may set them — 42501, measured).
const LIST_SERVER_OWNED = ['workspace_id', 'created_by', 'updated_by', 'archived_at', 'archived_by']
const SHOT_LIST_ROW_COLUMNS = without(COLUMN_ALLOWLIST.shot_lists, LIST_SERVER_OWNED)
const SHOT_LIST_ITEM_ROW_COLUMNS = without(COLUMN_ALLOWLIST.shot_list_items, ['workspace_id', 'created_by', 'updated_by'])
const EDIT_ROW_COLUMNS = without(COLUMN_ALLOWLIST.edits, LIST_SERVER_OWNED)

/** Archived on this computer (the cloud gets it live, then archived through its function). */
export const isArchived = (row) => named(row?.archived_at)

/** A desktop shot list as the cloud's `shot_lists` takes it: live. */
export function shotListRowForCloud(list, projectId) {
  const row = onlyColumns(list, SHOT_LIST_ROW_COLUMNS)
  row.project_id = projectId
  return dropNulls(row, ['version', 'snapshot', 'created_at', 'updated_at'])
}

/** A desktop list item as the cloud's `shot_list_items` takes it. */
export function shotListItemRowForCloud(item, projectId) {
  const row = onlyColumns(item, SHOT_LIST_ITEM_ROW_COLUMNS)
  row.project_id = projectId
  return dropNulls(row, ['position', 'created_at', 'updated_at'])
}

/** A desktop edit as the cloud's `edits` takes it: live, its items one JSON array. */
export function editRowForCloud(edit, projectId) {
  const row = onlyColumns(edit, EDIT_ROW_COLUMNS)
  row.project_id = projectId
  return dropNulls(row, ['version', 'items', 'created_at', 'updated_at'])
}

/** "Title · v2", as the screens and the report name a list or an edit. */
export const listLabel = (row) => `${String(row?.title ?? '').trim()} · v${row?.version ?? 1}`

/** The items list by list (in the order the lists come), each list's in the order this computer keeps them. */
export function itemsInListOrder(items, lists) {
  const rank = new Map((lists || []).map((l, i) => [l?.id, i]))
  const at = (i) => (rank.has(i.shot_list_id) ? rank.get(i.shot_list_id) : rank.size)
  return (items || []).filter(isRow).map((it, n) => ({ it, n })).sort((a, b) => at(a.it) - at(b.it) || a.n - b.n).map(x => x.it)
}

/**
 * Rows ordered so each comes after the row it names as `parentKey` (the
 * cloud's keys need a parent to exist first). A row whose parent is not in
 * the set keeps its turn (the runner says why it cannot land); a cycle on
 * disk ends the ordering, its rows last, as they are.
 */
function parentsFirst(rows, parentKey) {
  const list = (rows || []).filter(isRow)
  const ids = new Set(list.map(r => r.id))
  const out = []
  const placed = new Set()
  let pending = list
  while (pending.length) {
    const next = pending.filter(r => !named(r[parentKey]) || placed.has(r[parentKey]) || !ids.has(r[parentKey]))
    if (!next.length) { out.push(...pending); break }
    for (const r of next) { out.push(r); placed.add(r.id) }
    pending = pending.filter(r => !placed.has(r.id))
  }
  return out
}

/** Edits, each after its parent (0084's guard: the parent must already exist, 23503 — measured). */
export const editsParentsFirst = (edits) => parentsFirst(edits, 'parent_edit_id')

// ── Folders (0041) ──────────────────────────────────────────────────────────

const FOLDER_ENTITY_FKS = ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']
const FOLDER_ROW_COLUMNS = without(COLUMN_ALLOWLIST.folders, ['workspace_id', 'created_by', 'updated_by'])

/** The entity a folder (or a file) is about — its first set link, as fileTree.js reads one — or null. */
export function entityOf(row) {
  for (const fk of FOLDER_ENTITY_FKS) if (named(row?.[fk])) return { fk, id: row[fk] }
  return null
}

/** Folders, each after its parent (0041: a folder's parent is a row of the table). */
export const foldersParentsFirst = (folders) => parentsFirst(folders, 'parent_id')

/** A desktop folder as the cloud's `folders` takes it, under its parent's id IN THE CLOUD. */
export function folderRowForCloud(folder, projectId, parentCloudId) {
  const row = onlyColumns(folder, FOLDER_ROW_COLUMNS)
  row.project_id = projectId
  row.parent_id = parentCloudId ?? null
  return dropNulls(row, ['sort_order', 'created_at', 'updated_at'])
}

/**
 * What becomes of one desktop folder in the cloud, decided before any write:
 *   matched  the cloud holds it already — by its id, by its entity (one
 *            folder per asset, scene or shot: 0041's unique indexes), or a
 *            folder of the same kind at its path (one path per project) —
 *            and its children and files use the cloud's id;
 *   insert   it goes up with its id, under its parent's id in the cloud;
 *   orphan   the row it is the folder of, or its parent folder, was removed
 *            on this computer (the desktop keeps a removed row's folder; the
 *            cloud's foreign keys would have taken it): not carried, and not
 *            an error a second run could clear;
 *   taken    its path in the cloud is another row's folder (a namesake made
 *            there): not carried, said — its files stay at the project's top;
 *   failed   the row it is the folder of, or its parent folder, did not land
 *            in this run: said, and a second run brings it.
 *
 *   parent   the decision for its parent folder (absent: none on this
 *            computer; ignored for the root)
 *   cloud    { byId, byPath, byEntity } — this project's folders in the cloud
 *   state    (fk, id) → 'landed' | 'failed' | 'unread' | 'gone' — the row a
 *            folder is about, as this run left it (since M2 a level's and an
 *            experience's as well: the levels land before the folders)
 */
export function folderDecision(folder, { parent, cloud, state }) {
  if (folder.kind !== 'root') {
    if (!parent) return { action: 'orphan' }
    if (['orphan', 'taken', 'removed'].includes(parent.action)) return { action: parent.action === 'removed' ? 'orphan' : parent.action }
    if (parent.action === 'failed') return { action: 'failed', why: 'its parent folder is not in the cloud' }
  }
  const ent = entityOf(folder)
  if (ent) {
    const s = state(ent.fk, ent.id)
    if (s === 'gone') return { action: 'orphan' }
    if (s === 'unread') return { action: 'failed', why: `whether its ${ent.fk.replace(/_id$/, '')} is in the cloud could not be checked (the read failed)` }
    if (s !== 'landed') return { action: 'failed', why: `its ${ent.fk.replace(/_id$/, '')} is not in the cloud` }
  }
  const mine = cloud.byId.get(folder.id)
  if (mine) return { action: 'matched', cloudId: mine.id }
  if (ent) {
    const theirs = cloud.byEntity.get(`${ent.fk}|${ent.id}`)
    if (theirs) return { action: 'matched', cloudId: theirs.id }
  }
  const atPath = cloud.byPath.get(folder.path)
  if (atPath) {
    const theirEnt = entityOf(atPath)
    const same = ent ? (theirEnt && theirEnt.fk === ent.fk && String(theirEnt.id) === String(ent.id)) : !theirEnt
    return same ? { action: 'matched', cloudId: atPath.id } : { action: 'taken' }
  }
  return { action: 'insert', parentCloudId: folder.kind === 'root' ? null : parent.cloudId }
}

/** The cloud's folder rows for a project, keyed three ways for folderDecision. */
export function cloudFolderIndex(rows) {
  const byId = new Map(); const byPath = new Map(); const byEntity = new Map()
  for (const r of rows || []) {
    if (!isRow(r)) continue
    byId.set(r.id, r)
    if (typeof r.path === 'string') byPath.set(r.path, r)
    const ent = entityOf(r)
    if (ent) byEntity.set(`${ent.fk}|${ent.id}`, r)
  }
  return { byId, byPath, byEntity }
}

/**
 * The desktop folder a file sits in, as the desktop's own explorer shows it
 * (src/components/Resources/fileTree.js): the folder its `folder_id` names,
 * else the folder of the row it is about (asset, scene, shot, level,
 * experience — the folder row carrying the same link), else none (the
 * project's top). A Legal file sits in LEGAL, which has no row in either
 * tree, so none (the cloud's own upload files it so, supabaseAdapter's
 * uploadFile). Measured: the desktop writes no `folder_id` on a file row
 * (projectFileStream.cjs), so a file's folder is its entity's.
 */
export function desktopFolderOfFile(file, folders) {
  if (!isRow(file) || isLegalFile(file)) return null
  const rows = (folders || []).filter(isRow)
  if (named(file.folder_id)) {
    const hit = rows.find(f => String(f.id) === String(file.folder_id))
    if (hit) return hit
  }
  for (const fk of FOLDER_ENTITY_FKS) {
    if (!named(file[fk])) continue
    const hit = rows.find(f => named(f[fk]) && String(f[fk]) === String(file[fk]))
    if (hit) return hit
  }
  return null
}

// ── Part 2 (M2, night 4): budgets, levels and experiences, links on tasks ──
//
// Each row through its table's columns (the cloud adapter's allowlist, less
// what the cloud stamps: the workspace, from the project, 0004; who made or
// changed it) and each value as its column takes it. Measured on wilson-dev:
// a NOT NULL column with a default refuses an explicit null (23502) and a
// number column a cleared field, '' (22P02) — the default applies when the
// key is left out.

const STAMPED = ['workspace_id', 'created_by', 'updated_by']
// The days a row was made and changed go up as this computer kept them (the
// cloud's columns take them; the adapter's lists leave them to its defaults).
const DAYS = ['created_at', 'updated_at']
const withDays = (set) => new Set([...set, ...DAYS])

/** Leave out each key whose value is null or '' (a NOT NULL column with a default). */
function dropBlank(row, keys) {
  for (const k of keys) if (k in row && (row[k] == null || row[k] === '')) delete row[k]
  return row
}
/** A nullable number or reference cleared to '' is none (22P02 in a number, a uuid or a timestamp). */
function blankToNull(row, keys) {
  for (const k of keys) if (row[k] === '') row[k] = null
  return row
}

/** The kinds 0037's CHECK takes (budget_versions_type_check). */
export const VERSION_TYPES = Object.freeze(['bid', 'actual', 'final'])
// Not locked_by: who locked it is a person on this computer, and the cloud
// knows people by their accounts (a claim the file cannot prove — the rule
// for every maker column here); the lock's day goes up.
const VERSION_ROW_COLUMNS = without(withDays(COLUMN_ALLOWLIST.budget_versions), [...STAMPED, 'locked_by'])

/**
 * A desktop bid version as the cloud's `budget_versions` takes it. Its shot
 * list is the runner's to keep or let go (0084's composite key refuses a
 * list the cloud does not hold for this project, 23503 — measured); a version
 * with no name gets one in the app's words for a nameless row ("Untitled
 * scene", "Untitled shot"): `name` is NOT NULL with no default (23502), and
 * the desktop's own add refuses an empty one.
 */
export function budgetVersionRowForCloud(v, projectId) {
  const row = onlyColumns(v, VERSION_ROW_COLUMNS)
  row.project_id = projectId
  if (!named(String(row.name ?? '').trim())) row.name = 'Untitled version'
  if ('type' in row && !VERSION_TYPES.includes(row.type)) delete row.type
  blankToNull(row, ['shot_list_id', 'summary', 'locked_at'])
  return dropBlank(row, ['type', 'is_active', 'snapshot', 'created_at', 'updated_at'])
}

/** The sheets 0037's CHECK takes (budget_lines_sheet_check). */
export const LINE_SHEETS = Object.freeze(['crew', 'talent', 'expenses_travel'])
const LINE_ROW_COLUMNS = without(withDays(COLUMN_ALLOWLIST.budget_lines), STAMPED)
const LINE_DEFAULTED = ['sheet', 'sort_order', 'is_section_header', 'rate', 'days', 'qty', 'cost', 'is_na_days', 'is_na_qty', 'agency_opt_out', 'created_at', 'updated_at']
/** A line's own percentages (null: the project's applies). NUMERIC(7,3), none below zero (budget_lines_pct_nonneg) — measured. */
export const LINE_PCTS = Object.freeze(['margin_pct', 'contingency_pct', 'talent_agency_fee_pct'])
// NUMERIC(7,3)'s room: a value that rounds to 10,000 overflows (22003).
const PCT_ROOM = 9999.9995
const pctHeld = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < PCT_ROOM }

/**
 * A desktop budget line as the cloud's `budget_lines` takes it. A section
 * header's numbers are null in the fixtures (23502 on rate — measured); the
 * desktop's own add writes 0. Its `team_member_id` names one of the desktop's
 * team members, never a cloud person (0037's comment: on the cloud it is a
 * workspace member's user id), so it goes up empty — team members move with
 * a later run (night 5) — and the runner counts it. A percentage of its own
 * the column cannot hold — below zero (the desktop's inputs do not stop one),
 * past NUMERIC(7,3)'s room, or no number — refused the whole line, and every
 * actual on it, on every run (23514, 22003, 22P02 — measured; review round
 * 1): it goes up empty, so the line takes the project's, and the runner says
 * so.
 */
export function budgetLineRowForCloud(line, projectId) {
  const row = onlyColumns(line, LINE_ROW_COLUMNS)
  row.project_id = projectId
  if ('team_member_id' in row) row.team_member_id = null
  if ('sheet' in row && !LINE_SHEETS.includes(row.sheet)) delete row.sheet
  blankToNull(row, LINE_PCTS)
  for (const k of LINE_PCTS) if (row[k] != null && !pctHeld(row[k])) row[k] = null
  return dropBlank(row, LINE_DEFAULTED)
}

/** The sources 0037's CHECK takes (budget_actuals_source_check). */
export const ACTUAL_SOURCES = Object.freeze(['manual', 'timecard', 'expense'])
/** An attachment that is a files row of this project: `file:<uuid>` (InvoiceAttachment.jsx). */
export const FILE_REF = 'file:'
/** An actual's attachment that is a path on one computer (the desktop-only builds before InvoiceAttachment): no address in the cloud. */
export const isLegacyAttachment = (path) => named(path) && !String(path).startsWith(FILE_REF)
const ACTUAL_ROW_COLUMNS = without(withDays(COLUMN_ALLOWLIST.budget_actuals), STAMPED)

/**
 * A desktop actual as the cloud's `budget_actuals` takes it: a source the
 * CHECK lacks is left out (manual applies; the desktop's own writes are
 * manual); an attachment that is a path on this computer is left out with
 * its name (the runner counts it); its line is the runner's to check.
 */
export function budgetActualRowForCloud(a, projectId) {
  const row = onlyColumns(a, ACTUAL_ROW_COLUMNS)
  row.project_id = projectId
  if ('source' in row && !ACTUAL_SOURCES.includes(row.source)) delete row.source
  if (isLegacyAttachment(row.attachment_path)) { row.attachment_path = null; row.attachment_name = null }
  blankToNull(row, ['attachment_path', 'invoice_number', 'notes'])
  if (row.expense_id != null && !UUID.test(String(row.expense_id))) row.expense_id = null
  return dropBlank(row, ['value', 'source', 'created_at', 'updated_at'])
}

const EXPENSE_ROW_COLUMNS = without(withDays(COLUMN_ALLOWLIST.expenses), STAMPED)
const EXPENSE_ARRAYS = ['asset_ids', 'phase_ids', 'task_ids', 'file_ids']

/**
 * A desktop expense as the cloud's `expenses` takes it: its purchase day as a
 * DATE stores one (the desktop's add writes '', 22007 — measured), each of
 * its four lists an array of ids (NOT NULL, 23502; an entry that is no id
 * would refuse the row, 22P02).
 */
export function expenseRowForCloud(e, projectId) {
  const row = onlyColumns(e, EXPENSE_ROW_COLUMNS)
  row.project_id = projectId
  if ('purchase_date' in row) row.purchase_date = cloudDay(row.purchase_date)
  for (const k of EXPENSE_ARRAYS) {
    if (!(k in row)) continue
    if (Array.isArray(row[k])) row[k] = row[k].filter(id => UUID.test(String(id)))
    else delete row[k]
  }
  return dropBlank(row, ['title', 'estimated_cost', 'actual_cost', 'created_at', 'updated_at'])
}

/** A rate set for one of the desktop's team members (its member_id), which a later run carries with the team (night 5). The desktop writes a role's or a person's, never both (0037's CHECK). */
export const isMemberRate = (o) => named(o?.member_id)
const OVERRIDE_ROW_COLUMNS = without(withDays(COLUMN_ALLOWLIST.project_rate_overrides), STAMPED)

/** A desktop role rate as the cloud's `project_rate_overrides` takes it. */
export function rateOverrideRowForCloud(o, projectId) {
  const row = onlyColumns(o, OVERRIDE_ROW_COLUMNS)
  row.project_id = projectId
  row.member_id = null
  blankToNull(row, ['day_rate', 'week_rate', 'month_rate', 'wage', 'notes'])
  return dropBlank(row, ['currency', 'created_at', 'updated_at'])
}

/** The statuses 0040's CHECK takes (levels_status_chk, experiences_status_chk): EntityListView's nine. */
export const ENTITY_STATUSES = Object.freeze(['not_started', 'in_progress', 'pending_review', 'needs_revisions', 'approved', 'final', 'blocked', 'on_hold', 'omitted'])
// Not thumbnail_image: a path to a picture on this computer's disk (counted
// with the scenes' and shots' pictures, NOT_CARRIED's `thumbnails`).
const LEVEL_ROW_COLUMNS = without(COLUMN_ALLOWLIST.levels, [...STAMPED, 'thumbnail_image'])

/**
 * A desktop level or experience (0040 gives both the same columns) as the
 * cloud's table takes it: not the older add's `files` key (42703 — measured;
 * since S4c the picked files are uploaded instead), a status the CHECK takes
 * or the default (a null status refuses the row, 23502 — measured), its days
 * as a DATE stores them.
 */
export function levelRowForCloud(row0, projectId) {
  const row = onlyColumns(row0, LEVEL_ROW_COLUMNS)
  row.project_id = projectId
  if ('status' in row && !ENTITY_STATUSES.includes(row.status)) delete row.status
  for (const k of ['start_date', 'end_date']) if (k in row) row[k] = cloudDay(row[k])
  return dropBlank(row, ['status', 'sort_order', 'created_at', 'updated_at'])
}

// 0000's columns less what the cloud stamps (fn_audit_touch: who made it,
// measured; the edit columns). NOT project_id: the desktop stamps one and
// the cloud has no such column (42703 — measured).
const TASK_LINK_ROW_COLUMNS = new Set(['id', 'task_id', 'label', 'url', 'created_at'])

/** A desktop link on a task as the cloud's `task_links` takes it. */
export function taskLinkRowForCloud(link) {
  return dropBlank(onlyColumns(link, TASK_LINK_ROW_COLUMNS), ['created_at'])
}

/**
 * The files a bundle names as receipts — an expense's `file_ids`, an
 * actual's `file:<id>` attachment — which go up behind the money gate
 * whatever their own flag: a receipt uploaded before C4 went in as an
 * ordinary file (`{ type: 'expense' }`, read by nothing), is_financial false,
 * and would have landed where every project member reads it (the handbook's
 * §12.9, residual 3).
 */
export function receiptFileIds(bundle) {
  const ids = new Set()
  for (const e of Array.isArray(bundle?.expenses) ? bundle.expenses : []) {
    for (const id of Array.isArray(e?.file_ids) ? e.file_ids : []) if (named(id)) ids.add(String(id))
  }
  for (const a of Array.isArray(bundle?.budgetActuals) ? bundle.budgetActuals : []) {
    const p = a?.attachment_path
    if (typeof p === 'string' && p.startsWith(FILE_REF) && p.length > FILE_REF.length) ids.add(p.slice(FILE_REF.length))
  }
  return ids
}

/** Phases, each after the phase it sits in (phases_parent_phase_id_fkey is a plain, immediate key). */
export const phasesParentsFirst = (phases) => parentsFirst(phases, 'parent_phase_id')

// ── The second run's record (M2) ────────────────────────────────────────────
//
// Every table the runner carries is hard delete, or soft delete with a purge
// (0014): a row a teammate removed in the cloud would come back on the next
// run, which skipped by key only. The record is the ids each run carried,
// per workspace, kept in the desktop's bundle beside the rows it is about —
// read with the bundle the runner already fetches (the dry run reads the same
// one), written through the desktop's own route as rows land, archived with
// the bundle by "Archive and clear local", and copied with the project's
// folder to another computer. An id in it is never inserted again.

/** The key of the record in a desktop bundle (electron/main.cjs's route writes it). */
export const RECORD_KEY = 'cloudMigration'

/** What earlier runs carried into `workspaceId` from this bundle: `Map<table, Set<id>>`. */
export function carriedRecordOf(bundle, workspaceId) {
  const carried = bundle?.[RECORD_KEY]?.[workspaceId]?.carried
  const out = new Map()
  if (!carried || typeof carried !== 'object' || Array.isArray(carried)) return out
  for (const [table, ids] of Object.entries(carried)) {
    if (Array.isArray(ids)) out.set(table, new Set(ids.filter(named).map(String)))
  }
  return out
}
