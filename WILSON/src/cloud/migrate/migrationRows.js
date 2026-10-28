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
// Measured on wilson-dev (2026-10-28, each a rolled-back INSERT; the M1
// hand-off quotes every response): a desktop project row is refused whole
// for `documents` (42703: none of documents, visualAssets, files_dir is a
// column), for a locked or an open bid version the cloud does not have
// (23503: projects_budget_active_version_id_fkey, projects_open_budget_
// version_fk), and for its folder on this computer (P0001,
// fn_project_folder_root_guard: an admin's or a manager's, inside the
// company's storage drive, or none); a comment for `project_id` (42703); a
// milestone for `name` (42703, the fixtures carry it); a shot list or an
// edit that arrives archived (42501, 0084's guard); an edit before its parent
// (23503); a level's folder while levels stay on this computer (23503).
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

// ── The project row ─────────────────────────────────────────────────────────

/**
 * The project's own keys that the cloud row does not take from the file:
 *   - its active shot list: set through set_active_shot_list() once its lists
 *     are in (0084: the pointer's composite foreign key, and the guard that
 *     reserves it for that function);
 *   - its locked and open bid versions: budgets move in part 2 of the
 *     migration, which sets them again (measured: both foreign keys refuse an
 *     id the cloud does not hold, and with it the whole project);
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
 * The cloud's `project_status` values (0000's enum, read on wilson-dev). The
 * desktop also offers `draft` and `wrapped` (the project's settings) and
 * `inactive` (the Projects page), which the type refuses (22P02) — and with
 * them the whole project.
 */
export const CLOUD_PROJECT_STATUSES = Object.freeze(['active', 'on_hold', 'completed', 'archived', 'cancelled'])
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

/**
 * A desktop project row as the cloud's `projects` takes it, in the target
 * workspace — its columns (above), and values each column's type and checks
 * take, as the cloud adapter's own writes shape them (mapDogProjectFields):
 *   - the dates: D.O.G.'s new-project window writes `startDate` / `endDate`
 *     alone and the Projects page writes both; a cleared field is '' (a DATE
 *     column refuses it, 22007). Each goes up as an ISO day or nothing
 *     (dates.js's toIsoDate takes a stray spelling as the column stores it);
 *   - a status the cloud does not have is left out, so the cloud's default
 *     (active) applies; projectLeftAtHome names it for the report;
 *   - a null where the column has a default, an empty or non-numeric number,
 *     a negative percentage, an actuals mode or column count outside the
 *     budget settings' checks (0036): left out, so the default applies;
 *   - no title (the column has no default): the desktop's own word for one.
 */
export function projectRowForCloud(project, workspaceId) {
  const p = isRow(project) ? project : {}
  const row = onlyColumns(p, PROJECT_ROW_COLUMNS)
  for (const [col, dog] of [['start_date', 'startDate'], ['end_date', 'endDate']]) {
    const v = named(p[dog]) ? p[dog] : p[col]
    if (named(v)) row[col] = toIsoDate(v) || null
    else if (col in row || dog in p) row[col] = null
  }
  // '' too: the type refuses it as it does a word it lacks (22P02).
  if ('status' in row && !CLOUD_PROJECT_STATUSES.includes(row.status)) delete row.status
  for (const k of PROJECT_NUMBERS) if (k in row && row[k] != null && (row[k] === '' || !Number.isFinite(Number(row[k])))) delete row[k]
  // INTEGER columns (0040, 0036) refuse a fraction (22P02).
  for (const k of PROJECT_INTEGERS) if (row[k] != null && !Number.isInteger(Number(row[k]))) delete row[k]
  for (const k of ['budget_margin_pct', 'budget_contingency_pct', 'budget_agency_pct']) if (row[k] != null && Number(row[k]) < 0) delete row[k]
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

/** What the project row leaves on this computer that the report names: its bid version pointers (part 2), its folder, a status the cloud does not have, its deck attachments not yet moved. */
export function projectLeftAtHome(project) {
  const p = isRow(project) ? project : {}
  const count = (k) => (Array.isArray(p[k]) ? p[k].length : 0)
  return {
    bidVersions: named(p.budget_active_version_id) || named(p.open_budget_version_id),
    folder: named(p.folder_root),
    status: named(p.status) && !CLOUD_PROJECT_STATUSES.includes(p.status) ? String(p.status) : null,
    deckAttachments: count('documents') + count('visualAssets'),
  }
}

// ── Milestones (0067) ───────────────────────────────────────────────────────

// The editor's columns and the spine; not workspace_id (stamped from the
// project), not who made it, not deleted_at (a trashed row is not carried:
// the cloud's trash is its own) nor set_aside_at (a set-aside row arrives
// live, as phases and tasks do: bid versions are part 2's). Not `name`, which
// the fixtures carry beside `title` (42703, measured).
const MILESTONE_ROW_COLUMNS = without(COLUMN_ALLOWLIST.milestones, ['workspace_id', 'created_by', 'updated_by'])

/** A desktop milestone as the cloud's `milestones` takes it. */
export function milestoneRowForCloud(m, projectId) {
  const row = onlyColumns(m, MILESTONE_ROW_COLUMNS)
  row.project_id = projectId
  // A DATE column refuses '' (22007): an editor that cleared the field sends
  // it. A day goes up as the column stores one (dates.js's toIsoDate).
  if ('date' in row) row.date = named(row.date) ? (toIsoDate(row.date) || null) : null
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
 *   left     a level's or an experience's (part 2 carries levels and
 *            experiences; the cloud refuses a folder of a row it does not
 *            hold, 23503 — measured), and anything inside one;
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
 *   state    (fk, id) → 'landed' | 'failed' | 'gone' | 'left' — the row a
 *            folder is about, as this run left it
 */
export function folderDecision(folder, { parent, cloud, state }) {
  if (folder.kind !== 'root') {
    if (!parent) return { action: 'orphan' }
    if (['left', 'orphan', 'taken'].includes(parent.action)) return { action: parent.action }
    if (parent.action === 'failed') return { action: 'failed', why: 'its parent folder is not in the cloud' }
  }
  const ent = entityOf(folder)
  if (ent) {
    const s = state(ent.fk, ent.id)
    if (s === 'left' || s === 'gone') return { action: s === 'left' ? 'left' : 'orphan' }
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
