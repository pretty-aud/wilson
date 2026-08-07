// ============================================================
// RABBIT v0.1 — Supabase adapter (FULL CRUD + Realtime + Storage)
// ============================================================
//
// This is the recommended cloud backend for RABBIT.
//
// Config: pulled from the shared authenticated client at
//         src/cloud/auth/supabaseClient.js. That client is configured
//         at build time by VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
//         and receives its session from the Electron main process over
//         the safeStorage-backed IPC in src/cloud/auth/session.js.
//
//         There is no adapter-owned credential state. If the user is
//         not logged in, getClient() returns null and every adapter
//         call throws with a "no active session" message.
//
// Storage bucket: 'rabbit-files' (must exist; see db/README.md §3).
//   Upload key pattern: projects/{project_id}/{entity}/{id}/{filename}
//
// Realtime (Session 7, migration 0016): subscribeProjectChanges() joins
// the PRIVATE broadcast channel `rabbit:project:{id}`. Events originate
// from the fn_realtime_broadcast DB trigger (broadcast-from-database),
// NOT postgres_changes — under the 0014 soft-delete SELECT policies a
// postgres_changes subscriber would never receive the "row was trashed"
// UPDATE (the new row fails their SELECT policy), so collaborators would
// keep stale rows forever. Broadcast delivers full old/new rows for every
// write; channel access is authorized at join by the realtime.messages
// policies (can_read_project_topic). Presence rides the same channel.
//
// History: the Session 1 scaffolding kept a per-project `supabase.json`
// fallback so pre-migration tenants could keep running. Session 2
// removed that fallback: every query now carries the user's JWT and
// is scoped by RLS (see supabase/migrations/0004_rls_rabbit.sql).
//
// Soft delete (Session 6, migration 0014): the 7 user-facing tables
// (projects, phases, assets, tasks, files, comments, rate_cards) enter
// and leave the trash ONLY via the SECURITY DEFINER RPCs
// soft_delete_row() / restore_soft_deleted(). Plain UPDATEs cannot do
// either: SELECT policies apply to both sides of an UPDATE that reads
// the table, so setting deleted_at makes the NEW row invisible (RLS
// violation) and a hidden row can't be targeted for restore (0-row
// no-op). deleted_by is stamped/cleared server-side by
// fn_soft_delete_stamp. Link/leaf tables (task_dependencies,
// task_links, rate_card_entries) stay hard-delete.

import { supabase as sharedAuthedClient } from '../../../cloud/auth/supabaseClient.js';
// Session 26: paths are computed here, not in Postgres, so the Local Server
// route and this adapter produce the SAME tree for the same project. See
// folderPaths.js — the reasoning is S25's, applied to folders instead of names.
import {
  planProjectFolders, planEntityFolder, ENTITY_FK_COLUMN,
} from '../folderPaths';
import { serializeProjectManifest, MANIFEST_FILENAME } from '../projectManifest';
// Session 36: the storage provider registry (NETWORK_STORAGE_DESIGN.md §4a2b).
// This adapter IS Petal cloud, so its workspace provider is 'petal' today; S37
// and S38 add entries to the registry rather than branches here.
import {
  WORKSPACE_PROVIDERS,
  FILE_PROVIDERS,
  fileProviderFor,
  registerStorageProvider,
  getStorageProvider,
  resolveFileProvider,
} from '../storage';
import { createSupabaseStorageProvider } from '../storage/supabaseProvider';
import { serializeProjectRates, projectRatesPath } from '../projectRates';

// ───────────────────────────────────────────────────────────────
// Module-level singleton. One cached client reference per app session;
// auth state lives on the shared client itself, not in this module.
// ───────────────────────────────────────────────────────────────
let cachedClient = null;
let lastError    = null;
let lastSyncAt   = null;

async function getClient() {
  if (cachedClient) return cachedClient;
  try {
    const { data } = await sharedAuthedClient.auth.getSession();
    if (data?.session) {
      cachedClient = sharedAuthedClient;
      return cachedClient;
    }
  } catch (err) {
    lastError = err.message || String(err);
  }
  return null;
}

/**
 * Reset the cached client reference. Call after logout or workspace
 * switch so the next adapter call re-reads the shared session.
 */
export function resetSupabaseAdapter() {
  cachedClient = null;
  lastError    = null;
  lastSyncAt   = null;
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────
function unwrap({ data, error }) {
  if (error) {
    lastError = error.message || String(error);
    throw new Error(`[supabase] ${lastError}`);
  }
  lastError  = null;
  lastSyncAt = new Date();
  return data;
}

// Session 25: a bundle list whose table may not exist yet.
//
// `feat/multi-user-v1` auto-deploys the STAGING-backed beta on every push, so
// there is a real window in which the client is newer than the database. A
// bare unwrap() would 42P01 inside loadProject's Promise.all and make EVERY
// project fail to open until the migration lands — turning a missing feature
// into a total outage. Degrading to "no scenes yet" is the honest behaviour
// for that window.
//
// Only "relation does not exist" is absorbed. An RLS refusal, a network fault
// or any other error still throws, because those must not look like an empty
// list — that is precisely the mistake useRosterMembers makes, where a broken
// RPC and an empty workspace are indistinguishable at every call site.
// unwrap() itself cannot do this: it raises a new Error and drops `.code`.
function unwrapOptionalTable({ data, error }) {
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    lastError = error.message || String(error);
    throw new Error(`[supabase] ${lastError}`);
  }
  lastError  = null;
  lastSyncAt = new Date();
  return data || [];
}

async function requireClient() {
  const client = await getClient();
  if (!client) {
    throw new Error(
      '[supabase] no active session. Sign in via the login screen; the ' +
      'Supabase adapter has no per-project credential override.'
    );
  }
  return client;
}

// Session 36: register Supabase Storage as a provider under the four-function
// contract, once, at module load. Registration is idempotent in practice
// because this module is a singleton, and it is what gives the registry a LIVE
// caller from the day it ships rather than the day S37 lands — the repo's
// costliest pattern is a green test over a path nothing calls.
registerStorageProvider(
  FILE_PROVIDERS.SUPABASE,
  createSupabaseStorageProvider(requireClient),
);

function sanitize(obj, drop = []) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of drop) delete out[k];
  return out;
}

// ── Session 23: column ALLOWLISTS ───────────────────────────────
// sanitize() above is a DENYLIST — it removes the keys it is told about and
// passes everything else straight to PostgREST, which rejects the WHOLE
// request with PGRST204 the moment one key is not a column. That is a whole
// defect class, not a typo:
//
//   * the New Asset dialog sent start_date, due_date, task_template_id
//   * the Timeline task editor sent phase_id, scene_id, shot_id, level_id,
//     experience_id
//   * drag-to-phase, the bulk phase setter, the inline phase cell and
//     TaskDetailPopup all sent phase_id on a PATCH
//
// and because `x || null` still emits the key, blank fields failed too — so
// no user input could avoid it. Every one of those rejections was swallowed
// by a caller with no catch, which is why it looked like "nothing happens".
//
// 0034 added tasks.phase_id and 0035 added assets.start_date/due_date, so
// those are now real. 0040 added scenes/shots/levels/experiences (S25).
//
// 🚨 Session 28: `task_template_id` IS NOW A COLUMN, and the rule that kept
// it out is the reason it is in — not an exception to it. S23 wrote "a column
// for a feature with no cloud implementation is schema debt", which 0041
// applied again to `files_dir`. That rule was never "never add it"; it was
// "it arrives WITH its feature". 0044 is that arrival: task_templates exists,
// listProjectTaskTemplates is implemented below, and both writers become
// reachable in the same commit. `files_dir` stays out because its writer
// (the local relink route) still cannot run on this backend.
//
// Dropping the rest is right, but dropping it QUIETLY would repeat the
// original sin in a new place: the user's typed value would vanish with no
// error at all. So this warns every time, loudly, naming the table and the
// keys. If a warning fires for a field a user can actually edit, that field
// needs a column — not a bigger allowlist.
//
// created_at / updated_at are deliberately absent: they are server-managed
// and were already dropped by the sanitize() callers this replaces.

const TASK_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'asset_id', 'phase_id',
  'title', 'description', 'status', 'priority',
  'start_date', 'end_date', 'bid_days', 'logged_days',
  'assigned_position', 'assigned_role_slug', 'assigned_user_id',
  'assignee_id', 'reviewer_id', 'notes',
  'last_updated_by', 'last_updated_at', 'deleted_at', 'deleted_by',
  'created_by', 'updated_by',
]);

const ASSET_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'phase_id',
  'name', 'type', 'type_label', 'description', 'thumbnail_url', 'status',
  'sort_order', 'start_date', 'due_date',
  // 0044. Written at ProjectAssetsView.jsx:1390 (spread into the asset create
  // when a template is chosen) and :1742 (ctx.updateAsset after applying one
  // to an existing asset). Both were unreachable until this session, which is
  // why S23 left it out — see the note above.
  'task_template_id',
  'last_updated_by', 'last_updated_at', 'deleted_at', 'deleted_by',
  'created_by', 'updated_by',
]);

// ── Session 24 ──────────────────────────────────────────────────
// `projects` had NO allowlist, and toColumns() returns the object untouched
// when a table has no entry (see the `if (!allow …) return obj` below). So
// updateProject sent whatever it was handed straight to PostgREST, and one
// unknown key rejected the WHOLE patch with PGRST204 — the pre-S23 behaviour,
// still live on the one table the project settings panel writes to.
//
// That is the mechanism behind "I have tried to update the percentage and it
// doesn't save". The nine budget_* columns did not exist (0036 adds them),
// and the budget views also read `project.name` and `project.code`, which are
// STILL not columns — the cloud table has `title`, and the writer at
// ProjectSummaryView.jsx:605 sends `project_code`. Without an allowlist those
// strays would keep poisoning unrelated saves even after 0036.
//
// Listed from a census of the live table (2026-08-03, wilson-dev AND
// wilson-staging), not from a document. The audit/tenancy columns are
// included so this set mirrors the table faithfully; PATCH_DROP strips them
// before they ever reach here.
const PROJECT_COLUMNS = new Set([
  'id', 'workspace_id', 'title', 'description', 'status', 'status_tag',
  'start_date', 'end_date', 'budget_total', 'budget_currency',
  'client_name', 'cover_image_url', 'producer_id', 'director_id',
  // 0036 — the budget settings the UI has always read and never saved.
  'budget_margin_pct', 'budget_contingency_pct',
  'budget_agency_pct', 'budget_agency_enabled',
  'budget_actual_column_mode', 'budget_actual_column_count',
  'budget_active', 'budget_active_version_id', 'budget_finalized',
  // 0040 — the Project Control Panel's other seventeen fields, every one of
  // them written by ProjectSummaryView and silently dropped until now.
  //
  // NOTE `project_code`, NOT `code`. Nothing in the app has ever written a
  // bare `code` key on a project; ClientViewTab merely READ one that never
  // existed. Both plan documents said to add `code` — see 0040's header.
  'project_code', 'scene_separator', 'scene_digits', 'shot_digits',
  'scene_start_number', 'fps',
  'scenes_enabled', 'levels_enabled', 'experiences_enabled',
  'uses_realtime_engine', 'engine_type', 'engine_proprietary_name',
  'engine_version', 'engine_project_name', 'engine_repo_url',
  'project_type', 'project_tier',
  // 0049 (S35) — the column has existed in cloud since the base schema, but
  // the Control Panel's folder write was silently stripped here, so on a
  // desktop running the Supabase backend "Change folder" did nothing. It
  // joins the allowlist WITH its guard: fn_project_folder_root_guard now
  // enforces the admin/manager seat and containment inside
  // workspace_storage.root_path, so letting the write through is safe.
  // folder_slug deliberately stays OUT — nothing in cloud mode writes it,
  // and an allowlist entry without a writer is the dead-feature shape.
  'folder_root',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
]);

// ── 0040: the four entity tables ─────────────────────────────────────────
// Every one of these needs an allowlist entry, not because of the columns it
// HAS but because of the keys the UI sends that are not columns:
//   * addLevel / addExperience send `files` — an array of picked files from
//     the create dialog (LevelsView.jsx:1009). It has no column and belongs
//     to the folder/files work in S26.
//   * RabbitProvider re-sends whole rows on update (`{ ...existing, ...patch }`,
//     RabbitProvider.jsx:1333), so created_at/updated_at ride along.
// A table with NO entry passes through toColumns UNFILTERED, and one unknown
// key PGRST204s the entire request — that was the S23 "New task does
// nothing". The dropped keys are warned about, so a warning naming a field a
// user can edit means that field needs a column, not a bigger allowlist.
const SCENE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'name', 'description', 'notes',
  'scene_number', 'status', 'type', 'time_of_day', 'thumbnail_image',
  'start_date', 'end_date', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const SHOT_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'scene_id', 'name', 'description',
  'notes', 'shot_number', 'status', 'type', 'time_of_day', 'framing',
  'camera_movement', 'frame_count', 'thumbnail_image',
  'start_date', 'end_date', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

// Levels and experiences are the same shape — LevelsView.jsx and
// ExperiencesView.jsx are the same component with different nouns.
const LEVEL_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'name', 'description', 'notes',
  'status', 'thumbnail_image', 'start_date', 'end_date', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const EXPERIENCE_COLUMNS = new Set(LEVEL_COLUMNS);

// ── 0041: the folder tree ────────────────────────────────────────────────
// `workspace_id` is here for the same reason it is on SCENE_COLUMNS: the
// provider re-sends whole rows on update and PATCH_DROP strips it first.
// `parentPath` / `entityType` are NOT columns — folderInsertRow translates a
// plan into a row, and a plan carries neither.
const FOLDER_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'parent_id',
  'kind', 'entity_type',
  'asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id',
  'slug', 'label', 'path', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

// ── 0044: task templates ─────────────────────────────────────────────────
// `tasks` is one JSONB column, not a child table — 0044's header gives the
// three measured reasons, the first being that the editor's only write path
// replaces the whole array.
//
// 🚨 The template's own task objects ({ id, name, role_slug, bid_days,
// sort_order, depends_on }) are NOT filtered by anything here and must not be:
// they live INSIDE the jsonb value, so toColumns never sees them. Adding a
// field to a template task needs no change in this file. Adding a field to the
// TEMPLATE does.
const TASK_TEMPLATE_COLUMNS = new Set([
  'id', 'workspace_id', 'project_id',
  'name', 'description', 'tasks',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const BUDGET_LINE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id',
  'sheet', 'department', 'sort_order', 'label', 'description',
  'is_section_header', 'team_member_id', 'role_slug',
  'rate', 'days', 'qty', 'cost', 'is_na_days', 'is_na_qty',
  'margin_pct', 'contingency_pct',
  'agency_opt_out', 'talent_agency_fee_pct',
  'talent_type', 'agent_name', 'agency_name', 'email', 'phone', 'union_id',
  'created_by', 'updated_by',
]);

const BUDGET_ACTUAL_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'line_id', 'column_index', 'value',
  'invoice_number', 'expense_id', 'source', 'notes',
  'attachment_name', 'attachment_path',
  'created_by', 'updated_by',
]);

const BUDGET_VERSION_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'name', 'type', 'is_active',
  'snapshot', 'locked_at', 'locked_by', 'created_by', 'updated_by',
]);

const EXPENSE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'title', 'description',
  'estimated_cost', 'actual_cost', 'purchase_date',
  'asset_ids', 'phase_ids', 'task_ids', 'file_ids',
  'created_by', 'updated_by',
]);

const PROJECT_RATE_OVERRIDE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'role_slug', 'member_id',
  'day_rate', 'week_rate', 'month_rate', 'wage', 'currency', 'notes',
  'created_by', 'updated_by',
]);

// ── Session 27 ──────────────────────────────────────────────────────────
// `files` had NO allowlist entry, which was survivable only because the one
// writer (uploadFile) builds its row literally and updateFile's callers sent
// nothing exotic. S27 puts a file surface in front of the user in three new
// places — the Resources folder view, the entity FileManagers and the
// ProjectsPage drop zone — and every one of them patches file rows. A table
// with no entry passes through toColumns UNFILTERED, so the first invented
// key PGRST204s the whole request and the save silently does nothing.
//
// 0043's five new links are here; so are the local `managedFiles` field names
// deliberately ABSENT — stored_name, version_label, extension, original_name,
// notes. Those belong to the local_server JSON store and have no columns. If
// one shows up in the dropped-key warning, that is the signal to decide
// whether it deserves a column, not to widen this set.
const FILE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id',
  'phase_id', 'asset_id', 'task_id',
  // 0043 — where it is filed, and what it is about.
  'scene_id', 'shot_id', 'level_id', 'experience_id', 'folder_id',
  'name', 'mime_type', 'size_bytes',
  'storage_provider', 'storage_path', 'thumbnail_url',
  'kind', 'is_core_definer', 'is_financial',
  'uploaded_at',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
]);

export const COLUMN_ALLOWLIST = {
  tasks: TASK_COLUMNS,
  files: FILE_COLUMNS,
  assets: ASSET_COLUMNS,
  projects: PROJECT_COLUMNS,
  budget_lines: BUDGET_LINE_COLUMNS,
  budget_actuals: BUDGET_ACTUAL_COLUMNS,
  budget_versions: BUDGET_VERSION_COLUMNS,
  expenses: EXPENSE_COLUMNS,
  project_rate_overrides: PROJECT_RATE_OVERRIDE_COLUMNS,
  scenes: SCENE_COLUMNS,
  shots: SHOT_COLUMNS,
  levels: LEVEL_COLUMNS,
  experiences: EXPERIENCE_COLUMNS,
  folders: FOLDER_COLUMNS,
  task_templates: TASK_TEMPLATE_COLUMNS,
};

/**
 * Session 27 — which entity's FOLDER a file goes in, and therefore which path
 * segment it gets. Exported for uploadScope.test.js; pure, so it is tested
 * directly rather than through a stubbed Storage client.
 *
 * The CONTAINER is deliberately not the same thing as the file's entity links.
 * TaskDetailPopup mounts FileManager with assetId AND taskId: that file lives
 * in the asset's folder and is the task's attachment. 0043's header calls
 * these the two axes.
 *
 * The order matches FileManager.jsx:84's own parentType chain — scene before
 * shot — so the component and the adapter cannot disagree about where a file
 * went. (A shot is inside a scene, so shot-first would read more naturally;
 * FileManager is only ever handed one of the two, and matching the existing
 * component is worth more than tidiness here.)
 *
 * 🚨 EVERY `seg` IS LOWERCASE AND NONE IS A RESERVED WORD. This value becomes
 * the THIRD path segment of the storage key, which is the money gate
 * (migration 0042, public.rabbit_money_segment). A segment colliding with
 * INVOICES or FINANCE in any case would file an ordinary attachment into the
 * manager-only namespace, where the person who uploaded it could not read it
 * back — and no error would be raised at any layer.
 */
export function uploadContainerFor(scope = {}, projectId = null) {
  return (
    scope.sceneId      ? { seg: 'scenes',      key: 'scene_id',      id: scope.sceneId } :
    scope.shotId       ? { seg: 'shots',       key: 'shot_id',       id: scope.shotId } :
    scope.levelId      ? { seg: 'levels',      key: 'level_id',      id: scope.levelId } :
    scope.experienceId ? { seg: 'experiences', key: 'experience_id', id: scope.experienceId } :
    scope.assetId      ? { seg: 'assets',      key: null,            id: scope.assetId } :
    scope.taskId       ? { seg: 'tasks',       key: null,            id: scope.taskId } :
    scope.phaseId      ? { seg: 'phases',      key: null,            id: scope.phaseId } :
                         { seg: 'project',     key: null,            id: projectId }
  );
}

// Session 24: the UI initialises date fields to the empty STRING, not null —
// `purchase_date: ''` at useExpenses.js:105. Postgres 22007s on '' for a date
// column and takes the whole request with it. `x || null` is not enough on
// its own here (that was the S23 lesson about the KEY still being emitted);
// the value has to become a real NULL.
const DATE_FIELDS = new Set(['purchase_date', 'start_date', 'end_date', 'due_date', 'locked_at']);

function blankDatesToNull(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (DATE_FIELDS.has(k) && out[k] === '') out[k] = null;
  }
  return out;
}

// Exported for columnAllowlist.test.js. The older adapter tests
// (projectAttachments.test.js) MIRROR the logic they check, and say so as an
// honest limitation — a mirrored copy keeps passing while the adapter
// regresses. Exporting the real thing removes that gap for the allowlist,
// which is the piece with no other visible symptom: a missing entry does not
// fail a build, a type check or a render. It rejects one PostgREST request at
// runtime and the save appears to do nothing.
export function toColumns(table, obj) {
  const allow = COLUMN_ALLOWLIST[table];
  if (!allow || !obj || typeof obj !== 'object') return obj;
  const out = {};
  const dropped = [];
  for (const [k, v] of Object.entries(obj)) {
    if (allow.has(k)) out[k] = v;
    else dropped.push(k);
  }
  if (dropped.length) {
    console.warn(
      `[supabase] dropped ${dropped.length} field(s) not present on public.${table}: ` +
      `${dropped.join(', ')}. The write proceeded WITHOUT them. If a user can edit ` +
      `one of these, it needs a column — see supabaseAdapter COLUMN_ALLOWLIST.`
    );
  }
  return out;
}

// ── Folder-tree helpers (Session 26, migration 0041) ────────────────────
//
// Module-level rather than methods, because nothing else in this adapter uses
// `this` — one destructured `const { listFolders } = adapter` would break
// every method that leaned on it, silently and only at runtime.

function listFoldersWith(client, projectId) {
  // unwrapOptionalTable: a client deployed ahead of 0041 shows no folders
  // rather than failing every project load. Same treatment 0040's tables got,
  // and for the same reason — the web build ships continuously.
  return client.from('folders').select('*')
    .eq('project_id', projectId).order('path').then(unwrapOptionalTable);
}

async function foldersByPath(client, projectId) {
  const rows = await listFoldersWith(client, projectId);
  return new Map((rows || []).map(f => [f.path, f]));
}

// A planned folder becomes a row. `parent_id` is resolved from the sibling
// map rather than sent by the caller, because a plan is computed before any
// row exists and a category's parent may have been inserted moments ago.
function folderInsertRow(projectId, planned, byPath) {
  const parent = planned.parentPath === null ? null : byPath.get(planned.parentPath);
  const row = {
    project_id:  projectId,
    parent_id:   parent ? parent.id : null,
    kind:        planned.kind,
    entity_type: planned.entityType || null,
    slug:        planned.slug,
    label:       planned.label || null,
    path:        planned.path,
  };
  for (const fk of Object.values(ENTITY_FK_COLUMN)) {
    if (planned[fk]) row[fk] = planned[fk];
  }
  // workspace_id is stamped by trg_folders_populate_workspace, exactly as it
  // is for scenes — no client sends it.
  return toColumns('folders', row);
}

// Inserts when absent, mutates `byPath` in place, returns the new row or null
// when nothing was created. Used by both ensure* methods so they cannot drift.
async function insertFolderIfMissing(client, projectId, planned, byPath) {
  if (byPath.has(planned.path)) return null;
  const ins = await client.from('folders')
    .insert(folderInsertRow(projectId, planned, byPath)).select().single();
  if (ins.error) {
    // 23505 means a collaborator created the same folder between our read and
    // our write. That is not a failure — the folder exists, which is all the
    // caller asked for. Re-read so the map carries the row THEY inserted,
    // because a later child needs its real id for parent_id.
    if (ins.error.code !== '23505') {
      lastError = ins.error.message;
      throw new Error(`[supabase] ${ins.error.message}`);
    }
    for (const f of (await listFoldersWith(client, projectId)) || []) {
      byPath.set(f.path, f);
    }
    return null;
  }
  byPath.set(ins.data.path, ins.data);
  return ins.data;
}

// Columns a per-field patch must never carry: identity/tenancy, audit
// stamps, and the trash columns (RPC-only under the 0014 policies — a
// plain UPDATE with deleted_at either 42501s or silently no-ops).
const PATCH_DROP = [
  'id', 'workspace_id', 'created_at', 'created_by',
  'updated_at', 'updated_by', 'last_updated_at', 'last_updated_by',
  'deleted_at', 'deleted_by',
];

// D.O.G.'s unified-store project fields (Session 12). The cloud `projects`
// table has no such columns — an insert carrying them 42703s, which is how
// D.O.G.'s create-with-attachments silently broke in cloud mode. Dates map
// onto the canonical columns ('' clears → null; a bare '' 22007s on a date
// column); documents/visualAssets have no columns on the cloud `projects`
// table (locked #17: D.O.G. gets no content model) and are dropped, with
// `droppedAttachments` reported so create AND update fail LOUDLY rather than
// no-op'ing into silent data loss.
//
// Session 15 note: the cloud HOME for project files now exists — the
// rabbit-files bucket plus `files` rows (S14) — so this is no longer "there
// is nowhere to put them", it is "they do not belong on this row". Routing
// the ProjectsPage/D.O.G. attachment UI through uploadFile is the remaining
// half of MASTER_PLAN §6 #31, which carries the implementation plan.

// Session 15: an EMPTY documents/visualAssets array is not an attachment.
// ProjectsPage sends `documents: [], visualAssets: []` on every create, so a
// bare `documents !== undefined` test would refuse ordinary project creation.
// Only a non-empty array represents content that would be lost.
// Pinned by projectAttachments.test.js — keep the two copies in step.
function hasRealAttachments(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return (Array.isArray(payload.documents) && payload.documents.length > 0)
      || (Array.isArray(payload.visualAssets) && payload.visualAssets.length > 0);
}

const ATTACHMENTS_MSG =
  'Cloud projects store files as file records, not on the project row — '
  + 'this attachment was not saved. Upload it from the project’s Files list '
  + '(RABBIT), which writes to the rabbit-files bucket. See MASTER_PLAN §6 #31.';

function mapDogProjectFields(row) {
  if (!row || typeof row !== 'object') return { row, droppedAttachments: false };
  const out = { ...row };
  if (out.startDate !== undefined) {
    out.start_date = out.startDate || null;
    delete out.startDate;
  }
  if (out.endDate !== undefined) {
    out.end_date = out.endDate || null;
    delete out.endDate;
  }
  // ProjectDetailPanel sends the snake_case twin alongside — '' must clear.
  if (out.start_date === '') out.start_date = null;
  if (out.end_date === '') out.end_date = null;
  const droppedAttachments = out.documents !== undefined || out.visualAssets !== undefined;
  delete out.documents;
  delete out.visualAssets;
  return { row: out, droppedAttachments };
}

// Session 7 (LWW per field, locked decision): updates send ONLY the changed
// columns. The pre-S7 shape — upserting the caller's whole merged row —
// silently clobbered every field a collaborator changed since this client's
// last read. patchRow is the generic engine behind the per-table patch*
// methods the provider prefers when present.
async function patchRow(table, id, patch) {
  const client = await requireClient();
  // Session 23: the allowlist applies to PATCH too. Every phase-setting
  // gesture — drag between phase groups, the bulk setter, the inline cell,
  // TaskDetailPopup — sent phase_id before 0034 added the column, and each
  // one showed the change optimistically while the write died with PGRST204.
  const row = toColumns(table, sanitize(patch, PATCH_DROP));
  // Views clear fields by passing undefined (e.g. drag to the 'Unassigned'
  // group). JSON serialization would silently DROP those keys, turning the
  // gesture into an empty PATCH body (PostgREST error) — send NULL instead,
  // which is what "clear this field" means.
  for (const k of Object.keys(row)) {
    if (row[k] === undefined) row[k] = null;
  }
  // Nothing left after sanitize → no-op rather than an empty PATCH.
  if (Object.keys(row).length === 0) return null;
  return unwrap(await client.from(table).update(row).eq('id', id).select().single());
}

// ───────────────────────────────────────────────────────────────
// Adapter factory
// ───────────────────────────────────────────────────────────────
export function supabaseAdapter() {
  return {
    mode: 'supabase',

    // ── Status ────────────────────────────────────────────────
    async status() {
      const client = await getClient();
      if (!client) {
        return { online: false, lastSyncAt: null, error: lastError || 'no active session' };
      }
      try {
        // Cheap connectivity check — list one project header.
        const { error } = await client
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .limit(1);
        if (error) {
          lastError = error.message;
          return { online: false, lastSyncAt, error: lastError };
        }
        lastError = null;
        lastSyncAt = new Date();
        return { online: true, lastSyncAt, error: null };
      } catch (err) {
        return { online: false, lastSyncAt, error: err.message || String(err) };
      }
    },

    // ── Projects ──────────────────────────────────────────────
    async listProjects() {
      const client = await requireClient();
      return unwrap(await client
        .from('projects')
        .select('id, title, status, status_tag, updated_at, budget_total, budget_currency, client_name, cover_image_url')
        .order('updated_at', { ascending: false }));
    },

    async loadProject(projectId) {
      const client = await requireClient();
      // Session 24: budgetVersions and expenses join the bundle. The provider
      // does setBundle({ ...EMPTY_BUNDLE, ...next }), so any key this omits is
      // RESET TO [] on every load — which is why ctx.budgetVersions
      // (BudgetView.jsx:104) was permanently empty in cloud regardless of what
      // was in the database.
      //
      // budgetLines/budgetActuals are deliberately NOT here: they are owned by
      // the useBudgetLines hook, which loads them through its own adapter
      // calls and is not part of EMPTY_BUNDLE.
      //
      // Session 25: scenes/shots/levels/experiences join the bundle for the
      // same reason budgetVersions did — EMPTY_BUNDLE resets any key this
      // omits, so ctx.scenes (ScenesView.jsx:231) would read [] no matter what
      // the database held. They use unwrapOptionalTable so a client deployed
      // ahead of migration 0040 shows no scenes instead of failing every
      // project load; see the helper for why only 42P01 is absorbed.
      //
      // Session 26: `folders` joins for the third time for the same reason.
      // Ordered by path so the tree renders depth-first without a client-side
      // sort, and so both adapters return it in the same order.
      const [project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns, budgetVersions, expenses, projectMembers, scenes, shots, levels, experiences, folders] =
        await Promise.all([
          client.from('projects').select('*').eq('id', projectId).single().then(unwrap),
          client.from('phases').select('*').eq('project_id', projectId).order('sort_order').then(unwrap),
          client.from('assets').select('*').eq('project_id', projectId).order('sort_order').then(unwrap),
          client.from('tasks').select('*').eq('project_id', projectId).then(unwrap),
          client.from('task_dependencies').select('*, predecessor:tasks!task_dependencies_predecessor_id_fkey(project_id)')
            .eq('predecessor.project_id', projectId).then(unwrap).catch(() => []),
          client.from('task_links').select('*, task:tasks!inner(project_id)').eq('task.project_id', projectId).then(unwrap).catch(() => []),
          client.from('files').select('*').eq('project_id', projectId).then(unwrap),
          client.from('asset_versions').select('*, asset:assets!inner(project_id)').eq('asset.project_id', projectId).then(unwrap).catch(() => []),
          client.from('comments').select('*').then(unwrap), // entity_id filter happens client-side
          client.from('ingestion_runs').select('*').eq('project_id', projectId).then(unwrap),
          // Money is manager-only at the RLS layer (0037), so for a reviewer
          // or team member these legitimately return []. Catch rather than
          // fail the whole project load — a non-manager opening a project must
          // still get the project.
          client.from('budget_versions').select('*').eq('project_id', projectId)
            .order('created_at').then(unwrap).catch(() => []),
          client.from('expenses').select('*').eq('project_id', projectId)
            .then(unwrap).catch(() => []),
          // teamAssignments: which workspace members are ON this project.
          // In cloud that IS project_members. Mapped to the local bundle's
          // shape (`member_id`) so BudgetView.jsx:124 resolves the same way
          // on both adapters. project_title (0036) is the per-project JOB
          // TITLE and rides along here — it is NOT project_role, which is the
          // permission column every RLS gate reads.
          client.from('project_members')
            .select('project_id, user_id, project_role, project_title')
            .eq('project_id', projectId).then(unwrap).catch(() => []),
          // Ordered by sort_order to match the local bundle, which is an
          // array and therefore ordered by construction. Without this the two
          // adapters would disagree on row order for the same project.
          client.from('scenes').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('shots').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('levels').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('experiences').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('folders').select('*').eq('project_id', projectId)
            .order('path').then(unwrapOptionalTable),
        ]);
      return {
        project, phases, assets, tasks, dependencies, taskLinks, files,
        assetVersions, comments, ingestionRuns, budgetVersions, expenses,
        scenes, shots, levels, experiences, folders,
        teamAssignments: (projectMembers || []).map(m => ({
          project_id: m.project_id,
          member_id: m.user_id,
          project_role: m.project_role,
          project_title: m.project_title || '',
        })),
      };
    },

    async createProject(payload) {
      const client = await requireClient();
      // `workspace_id` is DROPPED, and that is a bug fix, not tidiness.
      // RabbitProvider.createProject stamps every draft with
      // DEFAULT_WORKSPACE_ID ('00000000-…-0001'), a pre-multi-tenant seed
      // constant that is harmless in local mode and fatal in cloud mode:
      // projects_insert requires `workspace_id = current_workspace_id()`, so
      // the insert was refused 42501 for EVERY workspace except the seed
      // one — i.e. every real tenant. Verified against wilson-dev: the seed
      // value is refused and the caller's own workspace succeeds, same
      // session, same statement. Omitting the column lets
      // trg_projects_populate_workspace (0029) derive it, the same way
      // assets/tasks/files/comments have derived theirs since 0004.
      // (Found by the Session 15 pre-commit review; pre-existing since S2.)
      const { row, droppedAttachments } = mapDogProjectFields(
        sanitize(payload, ['id', 'workspace_id', 'created_at', 'updated_at']),
      );
      // Session 15: createProject used to discard droppedAttachments entirely,
      // so D.O.G.'s create-with-attachments modal lost every file WITHOUT any
      // error at all in cloud mode. A create carrying real attachments now
      // refuses; an empty-array create (ProjectsPage always sends
      // documents: [], visualAssets: []) is not an attachment and passes.
      if (droppedAttachments && hasRealAttachments(payload)) {
        throw new Error(ATTACHMENTS_MSG);
      }
      const data = unwrap(await client.from('projects').insert(row).select().single());
      return data;
    },

    async updateProject(id, patch) {
      const client = await requireClient();
      const mapped = mapDogProjectFields(sanitize(patch, PATCH_DROP));
      const droppedAttachments = mapped.droppedAttachments;
      // Session 24: apply the allowlist AFTER mapDogProjectFields, so its
      // startDate -> start_date renames land on real column names first.
      // Before this, one unknown key (project.name, project.code, the nine
      // budget_* fields) rejected the entire patch with PGRST204 and the save
      // silently did nothing.
      const row = toColumns('projects', blankDatesToNull(mapped.row));
      // Session 15: this check used to sit INSIDE the `row is empty` branch,
      // so it only fired for attachments-ONLY patches. A mixed patch — say
      // { title, documents } from a rename that happened to carry the file
      // arrays along — passed straight through, saved the title, and dropped
      // the attachments silently. That is the exact failure the throw exists
      // to prevent, so it now guards every patch that carries attachments,
      // whatever else is in it.
      if (droppedAttachments && hasRealAttachments(patch)) {
        throw new Error(ATTACHMENTS_MSG);
      }
      if (Object.keys(row).length === 0) {
        // PostgREST treats update({}) as a 200 no-op — never let a patch that
        // reduced to nothing look like it saved.
        return unwrap(await client.from('projects').select('*').eq('id', id).single());
      }
      return unwrap(await client.from('projects').update(row).eq('id', id).select().single());
    },

    async deleteProject(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'projects', p_id: id }));
    },

    async restoreProject(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'projects', p_id: id }));
    },

    // ── Phases ────────────────────────────────────────────────
    async listPhases(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('phases').select('*').eq('project_id', projectId).order('sort_order'));
    },
    async upsertPhase(phase) {
      const client = await requireClient();
      const row = sanitize(phase, ['created_at', 'updated_at']);
      return unwrap(await client.from('phases').upsert(row).select().single());
    },
    async patchPhase(id, patch) { return patchRow('phases', id, patch); },
    async deletePhase(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'phases', p_id: id }));
    },
    async restorePhase(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'phases', p_id: id }));
    },

    // ── Assets ────────────────────────────────────────────────
    async listAssets(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('assets').select('*').eq('project_id', projectId).order('sort_order'));
    },
    async upsertAsset(asset) {
      const client = await requireClient();
      const row = toColumns('assets', sanitize(asset, ['created_at', 'updated_at']));
      return unwrap(await client.from('assets').upsert(row).select().single());
    },
    async patchAsset(id, patch) { return patchRow('assets', id, patch); },
    async deleteAsset(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'assets', p_id: id }));
    },
    async restoreAsset(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'assets', p_id: id }));
    },

    // ── Tasks ─────────────────────────────────────────────────
    async listTasks(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('tasks').select('*').eq('project_id', projectId));
    },
    async upsertTask(task) {
      const client = await requireClient();
      const row = toColumns('tasks', sanitize(task, ['created_at', 'updated_at']));
      return unwrap(await client.from('tasks').upsert(row).select().single());
    },
    async patchTask(id, patch) { return patchRow('tasks', id, patch); },
    async deleteTask(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'tasks', p_id: id }));
    },
    async restoreTask(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'tasks', p_id: id }));
    },

    // ── Dependencies ──────────────────────────────────────────
    async upsertDependency(dep) {
      const client = await requireClient();
      const row = sanitize(dep, []);
      return unwrap(await client.from('task_dependencies').upsert(row).select().single());
    },
    async deleteDependency(id) {
      const client = await requireClient();
      unwrap(await client.from('task_dependencies').delete().eq('id', id));
    },

    // ── Task links (free URLs) ────────────────────────────────
    async upsertTaskLink(link) {
      const client = await requireClient();
      return unwrap(await client.from('task_links').upsert(sanitize(link, ['created_at'])).select().single());
    },
    async deleteTaskLink(id) {
      const client = await requireClient();
      unwrap(await client.from('task_links').delete().eq('id', id));
    },

    // ── Files (Storage + metadata row) ────────────────────────
    async uploadFile(projectId, scope = {}, file) {
      const client = await requireClient();
      // Session 24: `INVOICES` is a RESERVED path segment, and the check
      // comes first so a financial file can never be filed under another
      // entity. Storage policy `rabbit_files_invoices_select` keys on exactly
      // this third segment, and the three base rabbit-files policies exclude
      // it — so the segment IS the gate for the blob, while
      // files.is_financial gates the row. Changing either without the other
      // opens a hole.
      //
      // 🚨 The case of this string is load-bearing and is matched by
      // migration 0039 with upper(). Audrey asked for the folder to be called
      // INVOICES; 0038 had shipped it lowercase. Renaming here WITHOUT 0039
      // would have inverted the gate completely — the new object would miss
      // the money-gated policy (invisible to managers) and fall through to
      // the base ones (visible to every project member). Keep the two in step.
      // Session 27: the CONTAINER — the entity whose folder this file lives
      // in. Deliberately separate from task_id/phase_id, which say what the
      // file is ABOUT and do not move it: TaskDetailPopup mounts FileManager
      // with assetId AND taskId, and that file belongs in the asset's folder
      // while still being the task's attachment. 0043's header calls these the
      // two axes; this is the single writer that keeps them agreeing.
      //
      // The order matches FileManager.jsx:84's own parentType chain (scene
      // before shot) so the component and the adapter cannot disagree about
      // where a file went.
      //
      // 🚨 EVERY SEGMENT HERE IS LOWERCASE AND NONE OF THEM IS A RESERVED
      // WORD. This string becomes the THIRD path segment, which is the money
      // gate (migration 0042, public.rabbit_money_segment). A container
      // segment that collided with INVOICES or FINANCE — in any case — would
      // file an ordinary attachment inside the manager-only namespace, where
      // the person who uploaded it could no longer read it back. Pinned by
      // uploadScope.test.js.
      const container = uploadContainerFor(scope, projectId);

      const entity   = scope.financial ? 'INVOICES' : container.seg;
      const entityId = scope.financial ? (scope.lineId || projectId) : container.id;
      const safeName = (file?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const storagePath = `projects/${projectId}/${entity}/${entityId}/${Date.now()}-${safeName}`;

      // The folder row this file belongs to (0043). The caller may pass one —
      // the folder view knows exactly where it dropped the file — otherwise
      // resolve it from the container entity, which is the same lookup
      // ensureEntityFolder does. Best-effort on purpose: a missing folder row
      // must not refuse an upload. The file is still fully addressable by its
      // storage_path and its entity link, and the next ensureEntityFolder
      // reconciles the tree.
      let folderId = scope.folderId || null;
      if (!folderId && container.key) {
        try {
          const { data } = await client
            .from('folders').select('id')
            .eq('project_id', projectId)
            .eq(container.key, container.id)
            .maybeSingle();
          folderId = data?.id || null;
        } catch { /* the tree is a convenience here, not a precondition */ }
      }

      // Session 36: which store holds this body. Decided ONCE, here, next to
      // the branch that already chose the INVOICES segment — so the row and
      // the path can never disagree about whether this file is money.
      //
      // 🚨 A FINANCIAL UPLOAD IS PINNED TO SUPABASE whatever the workspace
      // selected (§4a2b invariant 2): only RLS enforces the money gate, and
      // no Drive or S3 sharing model binds to a WILSON project role. Migration
      // 0050's files_money_provider_chk refuses the same rows in the database,
      // so a caller that bypasses this line is still refused.
      //
      // WORKSPACE_PROVIDERS.PETAL is a constant TODAY because this adapter IS
      // Petal cloud. S37 changes this one argument to the workspace's
      // configured provider; it does not add a branch.
      const storageProvider = fileProviderFor(WORKSPACE_PROVIDERS.PETAL, {
        financial: !!scope.financial,
      });
      try {
        await getStorageProvider(storageProvider).put(storagePath, file, {
          contentType: file?.type,
        });
      } catch (upErr) {
        lastError = upErr?.message || String(upErr);
        throw upErr;
      }

      const row = {
        project_id:       projectId,
        phase_id:         scope.phaseId || null,
        asset_id:         scope.assetId || null,
        task_id:          scope.taskId  || null,
        // 0043. Written unconditionally so a file that moves between entities
        // has every stale link cleared rather than accumulating them.
        scene_id:         scope.sceneId      || null,
        shot_id:          scope.shotId       || null,
        level_id:         scope.levelId      || null,
        experience_id:    scope.experienceId || null,
        folder_id:        folderId,
        name:             file?.name || safeName,
        mime_type:        file?.type || null,
        size_bytes:       file?.size ?? null,
        storage_provider: storageProvider,
        storage_path:     storagePath,
        kind:             scope.kind || 'source',
        is_core_definer:  !!scope.isCoreDefiner,
        // 0038. Must agree with the `invoices` path segment above: the row
        // and the blob are gated independently, and either one alone is a way
        // in — the amount is useless to hide if the invoice stating it is
        // readable.
        is_financial:     !!scope.financial,
      };
      const ins = await client.from('files').insert(row).select().single();
      if (ins.error) {
        // The blob landed but the row didn't — remove our own object so a
        // refused insert can't strand an orphan (rabbit_files_delete_own
        // policy, 0027). Best-effort: the GC orphan scan is the backstop.
        try { await getStorageProvider(storageProvider).del(storagePath); } catch { /* GC catches it */ }
      }
      return unwrap(ins);
    },

    async listFiles(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('files').select('*').eq('project_id', projectId));
    },

    async downloadFile(file) {
      const client = await requireClient();
      // 🚨 Session 36: the body comes from the provider THE ROW NAMES, not
      // from the workspace's current setting and not from which adapter is
      // running. Before this, all three adapters fetched unconditionally from
      // their own backend, so routing was decided per SESSION — which is
      // correct only while every row says the same thing. The day a workspace
      // switches provider, that assumption orphans everything already
      // written. Today every row still says 'supabase', so this resolves to
      // exactly the call it replaced.
      const data = await resolveFileProvider(file).get(file.storage_path);
      // S33 (0047, TPN-CONT-008 / TPN-LOG-002): every download leaves a
      // file_events row, written by the log_file_downloaded SECURITY DEFINER
      // RPC — the table itself stays append-only (no client INSERT).
      // Best-effort by the 0027 idiom (an audit hiccup must not take the
      // read down with it: the blob is already in hand), but never silent —
      // and rpc() resolves for every status (the trap documented at
      // supabaseOtterAdapter.js:253-255), so .error must be checked.
      try {
        const logged = await client.rpc('log_file_downloaded', { p_file_id: file.id });
        if (logged.error) console.warn('[supabase] download not logged:', logged.error.message);
      } catch (err) {
        console.warn('[supabase] download not logged:', err?.message || err);
      }
      return data; // Blob
    },

    async updateFile(id, patch) {
      const client = await requireClient();
      // Session 27: toColumns as well as sanitize. The denylist stops the two
      // fields that must never be patched; the ALLOWLIST is what stops an
      // unknown key taking the whole request with it (PGRST204). S27 puts
      // three new surfaces in front of file rows, and the local managedFiles
      // store uses field names — stored_name, notes, version_label — that have
      // no columns here and would otherwise arrive intact from shared code.
      const row = toColumns('files', sanitize(patch, ['id', 'uploaded_at']));
      return unwrap(await client.from('files').update(row).eq('id', id).select().single());
    },

    async deleteFile(id) {
      const client = await requireClient();
      // Storage blob intentionally left in place — the row must stay
      // restorable; blob GC is a documented known gap (db/README.md).
      unwrap(await client.rpc('soft_delete_row', { p_table: 'files', p_id: id }));
    },

    async restoreFile(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'files', p_id: id }));
    },

    // ── File lifecycle events (Session 14, migration 0027) ────
    // Read-only: file_events is populated by DB triggers on files; RLS
    // scopes reads to project readers + workspace admins. Second arg
    // (projectId) exists for interface parity with localServerAdapter.
    async listFileEvents(fileId, _projectId) {
      const client = await requireClient();
      const { data, error } = await client
        .from('file_events')
        .select('*')
        .eq('file_id', fileId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        // Pre-0027 database: behave like an empty stream (0012 idiom).
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message;
        throw new Error(`[supabase] listFileEvents failed: ${error.message}`);
      }
      return data || [];
    },

    // ── Asset versions ────────────────────────────────────────
    async upsertAssetVersion(version) {
      const client = await requireClient();
      return unwrap(await client.from('asset_versions').upsert(sanitize(version, ['created_at'])).select().single());
    },
    async listAssetVersions(assetId) {
      const client = await requireClient();
      return unwrap(await client.from('asset_versions').select('*').eq('asset_id', assetId).order('version_no', { ascending: false }));
    },

    // ── Comments ──────────────────────────────────────────────
    async createComment(comment) {
      const client = await requireClient();
      return unwrap(await client.from('comments').insert(sanitize(comment, ['id', 'created_at'])).select().single());
    },
    async listComments(entityType, entityId) {
      const client = await requireClient();
      return unwrap(await client
        .from('comments')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: true }));
    },
    async deleteComment(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'comments', p_id: id }));
    },
    async restoreComment(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'comments', p_id: id }));
    },

    // ── Edit history (Session 5, migration 0012) ──────────────
    // Read-only: the table is populated by DB triggers and RLS limits
    // reads to admin/manager within their workspace. entityType is the
    // table name ('assets', 'tasks', ...).
    async listEditHistory(entityType, entityId) {
      const client = await requireClient();
      const { data, error } = await client
        .from('edit_history')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        // Environment predates migration 0012 — treat as "no history yet"
        // rather than breaking the drawer (same tolerance as the
        // workspace_directory() fallback in useWorkspaceMembers).
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    // ── Project members (Session 6, migration 0013) ───────────
    // Roster rows: { project_id, user_id, workspace_id, project_role }.
    // user_id is a canonical auth user id (workspace_members.user_id).
    async listProjectMembers(projectId) {
      const client = await requireClient();
      const { data, error } = await client
        .from('project_members')
        .select('*')
        .eq('project_id', projectId);
      if (error) {
        // Environment predates migration 0013 — treat as "unstaffed"
        // rather than breaking the roster UI (same tolerance as
        // listEditHistory above).
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },
    async upsertProjectMember({ project_id, user_id, project_role }) {
      const client = await requireClient();
      // workspace_id is intentionally NOT sent — the BEFORE INSERT
      // trigger derives it from the project (0013).
      return unwrap(await client
        .from('project_members')
        .upsert({ project_id, user_id, project_role }, { onConflict: 'project_id,user_id' })
        .select()
        .single());
    },
    async removeProjectMember(projectId, userId) {
      const client = await requireClient();
      unwrap(await client
        .from('project_members')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId));
    },
    // Session 24: the per-project JOB TITLE ("Lead Animator") — 0036's
    // project_members.project_title.
    //
    // 🚨 This is deliberately a SEPARATE method from upsertProjectMember, and
    // it touches a different column. `project_role` is the PERMISSION setting
    // (manager/member/reviewer) that project_role_for() and every RLS gate
    // read. Writing a job title into it would silently break who can edit and
    // who can see money — an UPDATE here can never reach that column.
    async updateProjectMemberTitle(projectId, userId, projectTitle) {
      const client = await requireClient();
      return unwrap(await client
        .from('project_members')
        .update({ project_title: projectTitle || null })
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .select()
        .single());
    },

    // ── Dashboard: cross-project "my tasks" (Session 8) ───────
    // One indexed query over tasks.assignee_id / reviewer_id (0013) —
    // RLS supplies workspace scoping, trash hiding and trashed-parent
    // hiding for free. Embeds carry the labels the Dashboard renders so
    // no per-project bundle load is needed.
    async listMyTasks() {
      const client = await requireClient();
      const { data: sess } = await client.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return [];
      const { data, error } = await client
        .from('tasks')
        .select('*, project:projects(id,title,status), asset:assets(id,name,phase_id)')
        .or(`assignee_id.eq.${uid},reviewer_id.eq.${uid}`);
      if (error) {
        // Environment predates migration 0013 — no assignment columns,
        // so "my tasks" is correctly empty (same tolerance family as
        // listEditHistory).
        if (error.code === '42P01' || error.code === 'PGRST205'
            || error.code === '42703' || error.code === 'PGRST204') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    // Phase labels for the Dashboard's phase grouping (assets carry
    // phase_id; the names live here).
    async listPhasesByProjects(projectIds) {
      if (!projectIds?.length) return [];
      const client = await requireClient();
      const { data, error } = await client
        .from('phases')
        .select('id, name, project_id, sort_order')
        .in('project_id', projectIds);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    // Roster rows for a set of projects — the Dashboard derives
    // myProjectRole + projectIsStaffed per task's project from these
    // (rosters are workspace-visible, 0013).
    async listProjectMembersByProjects(projectIds) {
      if (!projectIds?.length) return [];
      const client = await requireClient();
      const { data, error } = await client
        .from('project_members')
        .select('project_id, user_id, project_role')
        .in('project_id', projectIds);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    // ── Notes (Session 8, migration 0017) ─────────────────────
    // Owner-only rows (RLS: workspace + owner_id = auth.uid(), no admin
    // bypass). The body is a Yjs snapshot in ydoc_state (base64 text);
    // `version` is the optimistic-concurrency counter. The list read
    // deliberately EXCLUDES ydoc_state — snapshots can be large and the
    // list only needs metadata + body_preview.
    async listNotes() {
      const client = await requireClient();
      const { data, error } = await client
        .from('notes')
        .select('id, title, subject, note_date, body_preview, version, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) {
        // Environment predates migration 0017 — no notes yet.
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    async getNote(id) {
      const client = await requireClient();
      const { data, error } = await client
        .from('notes')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null;
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? null;
    },

    async createNote(fields = {}) {
      const client = await requireClient();
      // owner_id / workspace_id fill from column defaults (auth.uid() /
      // current_workspace_id()); version starts at 0.
      const row = sanitize(fields, [
        'id', 'owner_id', 'workspace_id', 'version',
        'created_at', 'created_by', 'updated_at', 'updated_by',
      ]);
      return unwrap(await client.from('notes').insert(row).select().single());
    },

    // Metadata-only patch (title / subject / note_date / body_preview).
    // NEVER send ydoc_state or version through here — body saves go
    // through saveNoteDoc so the version guard can't be bypassed.
    async patchNote(id, patch) {
      return patchRow('notes', id, sanitize(patch, ['owner_id', 'ydoc_state', 'version']));
    },

    // Version-guarded Yjs snapshot save. Returns the updated
    // { id, version, updated_at } row, or NULL when the guard missed —
    // another device saved first; the caller merges the remote snapshot
    // into its local Y.Doc (updates are commutative + idempotent) and
    // retries with the fresh version.
    async saveNoteDoc(id, { ydocState, bodyPreview, expectedVersion }) {
      const client = await requireClient();
      const { data, error } = await client
        .from('notes')
        .update({
          ydoc_state:   ydocState,
          body_preview: bodyPreview ?? '',
          version:      expectedVersion + 1,
        })
        .eq('id', id)
        .eq('version', expectedVersion)
        .select('id, version, updated_at');
      if (error) {
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return (data ?? []).length > 0 ? data[0] : null;
    },

    // Hard delete (v1: notes have no trash — confirm in the UI).
    async deleteNote(id) {
      const client = await requireClient();
      unwrap(await client.from('notes').delete().eq('id', id));
    },

    // ── Note subjects (Session 8, migration 0017) ─────────────
    async listNoteSubjects() {
      const client = await requireClient();
      const { data, error } = await client
        .from('note_subjects')
        .select('*')
        .order('position')
        .order('label');
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return data ?? [];
    },

    async createNoteSubject({ label, position = 0 }) {
      const client = await requireClient();
      return unwrap(await client
        .from('note_subjects')
        .insert({ label, position })
        .select()
        .single());
    },

    async patchNoteSubject(id, patch) {
      return patchRow('note_subjects', id, sanitize(patch, ['owner_id']));
    },

    // Rename cascade: notes store the subject as a plain label, so renaming
    // an option must re-tag the owner's notes or they silently fall out of
    // the renamed filter/group (review finding). RLS owner-scopes the
    // UPDATE for free. Returns the re-tagged note ids.
    async retagNoteSubject(oldLabel, newLabel) {
      const client = await requireClient();
      const { data, error } = await client
        .from('notes')
        .update({ subject: newLabel })
        .eq('subject', oldLabel)
        .select('id');
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return (data ?? []).map(r => r.id);
    },

    async deleteNoteSubject(id) {
      const client = await requireClient();
      unwrap(await client.from('note_subjects').delete().eq('id', id));
    },

    // ── Ingestion runs + chunks ───────────────────────────────
    async createIngestionRun(run) {
      const client = await requireClient();
      return unwrap(await client.from('ingestion_runs').insert(sanitize(run, ['id', 'started_at', 'finished_at'])).select().single());
    },
    async updateIngestionRun(runId, patch) {
      const client = await requireClient();
      return unwrap(await client.from('ingestion_runs').update(sanitize(patch, ['id'])).eq('id', runId).select().single());
    },
    async listIngestionChunks(runId) {
      const client = await requireClient();
      return unwrap(await client.from('ingestion_chunks').select('*').eq('run_id', runId).order('chunk_index'));
    },
    async upsertIngestionChunk(chunk) {
      const client = await requireClient();
      return unwrap(await client.from('ingestion_chunks').upsert(chunk).select().single());
    },
    async updateChunk(chunk) {
      const client = await requireClient();
      return unwrap(await client.from('ingestion_chunks').update(sanitize(chunk, ['id'])).eq('id', chunk.id).select().single());
    },

    // ── Rate cards ────────────────────────────────────────────
    async listRateCards(workspaceId) {
      const client = await requireClient();
      return unwrap(await client.from('rate_cards').select('*').eq('workspace_id', workspaceId));
    },
    async upsertRateCard(card) {
      const client = await requireClient();
      return unwrap(await client.from('rate_cards').upsert(sanitize(card, ['created_at'])).select().single());
    },
    async deleteRateCard(id) {
      const client = await requireClient();
      unwrap(await client.rpc('soft_delete_row', { p_table: 'rate_cards', p_id: id }));
    },
    async restoreRateCard(id) {
      const client = await requireClient();
      // Via RPC: a plain UPDATE cannot see soft-deleted rows (SELECT
      // policies apply to the WHERE clause) and would no-op. See 0014.
      // Returns the RPC's boolean: false = row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'rate_cards', p_id: id }));
    },
    async listRateCardEntries(rateCardId) {
      const client = await requireClient();
      return unwrap(await client.from('rate_card_entries').select('*').eq('rate_card_id', rateCardId));
    },
    async upsertRateCardEntry(entry) {
      const client = await requireClient();
      return unwrap(await client.from('rate_card_entries').upsert(entry).select().single());
    },
    async deleteRateCardEntry(id) {
      const client = await requireClient();
      unwrap(await client.from('rate_card_entries').delete().eq('id', id));
    },

    // ── Task templates (Session 28, migration 0044) ───────────
    //
    // These five had ZERO occurrences in this file, so useTaskTemplates'
    // `if (!adapter.listTaskTemplates) return` guards fired on every call and
    // the New Asset dialog's Task Template dropdown was permanently empty in
    // cloud. Local Server has had them since S23 (electron/main.cjs:2610).
    //
    // 🚨 THE PROJECT READ DELIBERATELY DOES NOT PORT THE LOCAL PREDICATE.
    // `GET /projects/:id/task-templates` filters on project_id ALONE —
    // `!t.project_id || t.project_id === id` — which on a single-tenant local
    // server is fine and in a shared database would hand one workspace every
    // other workspace's global templates. The `.or()` below is the same
    // filter; what makes it safe is that RLS supplies the workspace scope the
    // local route omits (0044's task_templates_select). Port the intent, not
    // the predicate. pgTAP 54 probes 8-9 assert it with a presence control, so
    // "sees nothing" cannot pass merely because the table is empty.
    //
    // Ordering matches the local routes (name ASC) so the dropdown does not
    // reshuffle when a company switches backend.
    async listTaskTemplates(workspaceId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client
        .from('task_templates').select('*')
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true }));
    },
    async listProjectTaskTemplates(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client
        .from('task_templates').select('*')
        .or(`project_id.is.null,project_id.eq.${projectId}`)
        .order('name', { ascending: true }));
    },
    async upsertTaskTemplate(template) {
      const client = await requireClient();
      return unwrap(await client.from('task_templates')
        .upsert(toColumns('task_templates', sanitize(template, ['created_at'])))
        .select().single());
    },
    async updateTaskTemplate(id, patch) {
      const client = await requireClient();
      return unwrap(await client.from('task_templates')
        .update(toColumns('task_templates', sanitize(patch, PATCH_DROP)))
        .eq('id', id).select().single());
    },
    async deleteTaskTemplate(id) {
      const client = await requireClient();
      // Hard delete, matching Local Server (the route unlinks the file) and
      // `folders`. task_templates carries no deleted_at, so routing this
      // through soft_delete_row would 42703 rather than degrade.
      unwrap(await client.from('task_templates').delete().eq('id', id));
    },

    // ── Team members (Session 24) ─────────────────────────────
    //
    // The Crew/Team budget tab is driven by useTeamMembers() ∩ the project's
    // teamAssignments. `listTeamMembers` existed ONLY on localServerAdapter,
    // so in cloud `tm.members` was [] and the Crew tab rendered no one at all
    // — Audrey's "show each team member and their title" could not work.
    //
    // There is no separate cloud `team_members` table and there should not be
    // one: the roster already exists as workspace_members, exposed through
    // the workspace_directory() RPC (0010), which is SECURITY DEFINER and
    // already filters by the caller's LIVE membership rather than a JWT claim.
    // Mapped onto the local shape so one UI serves both adapters.
    //
    // Read only, deliberately. Creating/removing workspace members is the
    // Admin Terminal's job and goes through admin-create-user; a budget tab
    // must not be able to mint people. useTeamMembers feature-detects each
    // method separately, so the absent writers degrade cleanly.
    async listTeamMembers() {
      const client = await requireClient();
      const rows = unwrap(await client.rpc('workspace_directory')) || [];
      return rows
        .filter(r => r.is_active !== false)
        .map(r => ({
          id: r.user_id,                       // cloud identity IS the user id
          user_id: r.user_id,
          name: r.display_name || r.username || '(unnamed)',
          username: r.username,
          title: r.title || '',                // company job title
          department: r.department || '',
          avatar_url: r.avatar_url || null,
          email: r.email || null,
          app_role: r.app_role,
          // No cloud column. The local bundle carries it; defaulting keeps
          // CrewTeamTab's grouping working rather than rendering undefined.
          employment_type: 'fulltime',
        }));
    },

    // ── Budget (Session 24, migrations 0036 + 0037) ───────────
    //
    // Until this block existed, supabaseAdapter had ZERO budget methods, and
    // every consumer feature-detects: `if (!adapter?.listBudgetLines) return`
    // (useBudgetLines.js:60) returns BEFORE setLoading/setError, so the whole
    // budget rendered empty in cloud with no error and no console warning.
    // The methods below are the localServerAdapter surface, matched name for
    // name and argument for argument, so one UI serves both adapters.
    //
    // Reads are NOT wrapped in .catch(() => []): a reviewer's SELECT returns
    // an empty set rather than an error, so there is nothing to swallow, and
    // swallowing a genuine failure here would make a broken budget look like
    // an empty one. That distinction is exactly what useRosterMembers got
    // wrong (OUTSTANDING: an RPC failure and an empty workspace are
    // indistinguishable at every call site).

    async listBudgetLines(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('budget_lines').select('*')
        .eq('project_id', projectId).order('sort_order'));
    },
    async upsertBudgetLine(line) {
      const client = await requireClient();
      const row = toColumns('budget_lines', blankDatesToNull(line));
      return unwrap(await client.from('budget_lines').upsert(row).select().single());
    },
    async updateBudgetLine(id, projectId, patch) {
      // Per-field LWW, same rule as every other patch* method: send only what
      // changed, so a collaborator's edit to a different column survives.
      // NOTE margin_pct/contingency_pct are cleared by writing NULL — that is
      // how a line goes back to inheriting the project default — and patchRow
      // converts undefined to null for exactly that reason.
      return patchRow('budget_lines', id, patch);
    },
    async deleteBudgetLine(id) {
      const client = await requireClient();
      unwrap(await client.from('budget_lines').delete().eq('id', id));
    },

    async listBudgetActuals(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('budget_actuals').select('*')
        .eq('project_id', projectId));
    },
    async upsertBudgetActual(actual) {
      const client = await requireClient();
      const row = toColumns('budget_actuals', blankDatesToNull(actual));
      return unwrap(await client.from('budget_actuals').upsert(row).select().single());
    },
    async updateBudgetActual(id, projectId, patch) {
      return patchRow('budget_actuals', id, patch);
    },
    async deleteBudgetActual(id) {
      const client = await requireClient();
      unwrap(await client.from('budget_actuals').delete().eq('id', id));
    },

    async listBudgetVersions(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('budget_versions').select('*')
        .eq('project_id', projectId).order('created_at'));
    },
    async upsertBudgetVersion(version) {
      const client = await requireClient();
      // BudgetView spreads the WHOLE existing row back on every activate/
      // rename (`{ ...v, is_active }`, `{ ...activeVersion, snapshot }`), so
      // this payload carries created_at/updated_at and anything else the row
      // happens to hold. The allowlist is what stops those server-managed
      // columns reaching PostgREST.
      const row = toColumns('budget_versions', blankDatesToNull(version));
      return unwrap(await client.from('budget_versions').upsert(row).select().single());
    },
    async deleteBudgetVersion(id) {
      const client = await requireClient();
      unwrap(await client.from('budget_versions').delete().eq('id', id));
    },

    async listExpenses(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('expenses').select('*')
        .eq('project_id', projectId));
    },
    async upsertExpense(expense) {
      const client = await requireClient();
      // purchase_date arrives as '' from useExpenses.js:105 — a bare '' is a
      // 22007 on a date column and takes the whole request with it.
      const row = toColumns('expenses', blankDatesToNull(expense));
      return unwrap(await client.from('expenses').upsert(row).select().single());
    },
    async updateExpense(id, projectId, patch) {
      return patchRow('expenses', id, blankDatesToNull(patch));
    },
    async deleteExpense(id) {
      const client = await requireClient();
      unwrap(await client.from('expenses').delete().eq('id', id));
    },

    // Project-scoped rate overrides. A rate edited inside a project lands
    // HERE and must never write back to rate_cards / rate_card_entries, which
    // are workspace-wide — otherwise one project's negotiated rate silently
    // rewrites every other project's numbers.
    async listProjectRateOverrides(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('project_rate_overrides').select('*')
        .eq('project_id', projectId));
    },
    async upsertProjectRateOverride(override) {
      const client = await requireClient();
      const row = toColumns('project_rate_overrides', blankDatesToNull(override));
      return unwrap(await client.from('project_rate_overrides').upsert(row).select().single());
    },
    async deleteProjectRateOverride(id) {
      const client = await requireClient();
      unwrap(await client.from('project_rate_overrides').delete().eq('id', id));
    },

    // ── Scenes / shots / levels / experiences (0040) ──────────
    //
    // Session 25 — adapter PARITY. Audrey: "it shouldn't only be cloud. it
    // should be able to live in a local server as well." These eight methods
    // threw "table not yet created" until now, which is why the three views
    // were cloud-dead; the tabs themselves were also hidden, because
    // Rabbit.jsx:85-87 gates them on projects.scenes_enabled and friends,
    // which were not columns either. Both halves had to land together.
    //
    // Shape matches localServerAdapter exactly: list(projectId),
    // upsert(row) and delete(id, projectId). The projectId argument on the
    // deletes is unused here — the id is a UUID primary key and RLS already
    // scopes it to the caller's workspace — but it is in the signature for
    // interface parity, the same way listFileEvents carries one.
    //
    // Every upsert runs toColumns: RabbitProvider re-sends the whole existing
    // row on update, and the level/experience create dialog sends a `files`
    // array that has no column (S26 owns files). Without the allowlist those
    // keys PGRST204 the entire write, which is exactly how task creation
    // broke in S23.
    async listScenes(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client.from('scenes').select('*')
        .eq('project_id', projectId).order('sort_order'));
    },
    async upsertScene(scene) {
      const client = await requireClient();
      const row = toColumns('scenes', blankDatesToNull(scene));
      return unwrap(await client.from('scenes').upsert(row).select().single());
    },
    async deleteScene(id, _projectId) {
      const client = await requireClient();
      // Child shots go with it via ON DELETE CASCADE (0040). The UI also
      // deletes them one by one first (ScenesView.jsx:398-402); the cascade
      // makes the outcome atomic rather than dependent on that loop finishing.
      unwrap(await client.from('scenes').delete().eq('id', id));
    },

    async listShots(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client.from('shots').select('*')
        .eq('project_id', projectId).order('sort_order'));
    },
    async upsertShot(shot) {
      const client = await requireClient();
      const row = toColumns('shots', blankDatesToNull(shot));
      return unwrap(await client.from('shots').upsert(row).select().single());
    },
    async deleteShot(id, _projectId) {
      const client = await requireClient();
      unwrap(await client.from('shots').delete().eq('id', id));
    },

    async listLevels(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client.from('levels').select('*')
        .eq('project_id', projectId).order('sort_order'));
    },
    async upsertLevel(level) {
      const client = await requireClient();
      const row = toColumns('levels', blankDatesToNull(level));
      return unwrap(await client.from('levels').upsert(row).select().single());
    },
    async deleteLevel(id, _projectId) {
      const client = await requireClient();
      unwrap(await client.from('levels').delete().eq('id', id));
    },

    async listExperiences(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client.from('experiences').select('*')
        .eq('project_id', projectId).order('sort_order'));
    },
    async upsertExperience(experience) {
      const client = await requireClient();
      const row = toColumns('experiences', blankDatesToNull(experience));
      return unwrap(await client.from('experiences').upsert(row).select().single());
    },
    async deleteExperience(id, _projectId) {
      const client = await requireClient();
      unwrap(await client.from('experiences').delete().eq('id', id));
    },

    // ── Folders (0041) ────────────────────────────────────────
    //
    // Session 26 — the backend-agnostic folder tree. Audrey: R.A.B.B.I.T. is
    // also a project file manager and the tree must reflect in whichever
    // storage backend the company selected, not local disk only.
    //
    // The TABLE is the source of truth (Audrey, 2026-08-04) and the storage
    // path is derived from it. Supabase Storage has no real folders — it is
    // object storage with path prefixes, so an EMPTY folder cannot exist as
    // an object at all, and "toggling a category off never deletes the
    // folders" needs a folder that outlives its contents.
    //
    // Which is why nothing here writes to storage. A `.keep` placeholder
    // would exist only where files already do, and would make the empty
    // folders — the ones the requirement is about — the only ones that
    // vanish. The rows ARE the folders; S27 files objects under their paths.
    //
    // Paths come from folderPaths.js, shared with the Local Server route, so
    // the same project produces the same tree on both backends.
    async listFolders(projectId) {
      const client = await requireClient();
      return listFoldersWith(client, projectId);
    },

    // Idempotent, and idempotent the expensive way on purpose: it READS the
    // existing rows and inserts only what is missing, rather than upserting
    // the plan. An upsert would need a conflict target, and the natural one
    // (project_id, path) is exactly what a rename changes — so an upsert
    // would silently create a second row for a renamed folder instead of
    // moving the first. That is the double-folder bug this session exists to
    // prevent, arriving through the back door.
    async ensureProjectFolders(projectId, project) {
      const client = await requireClient();
      const byPath = await foldersByPath(client, projectId);
      const created = [];
      // Sequential, not Promise.all: a category's parent_id is the id of a
      // row this same loop may have just inserted.
      for (const planned of planProjectFolders(project)) {
        const row = await insertFolderIfMissing(client, projectId, planned, byPath);
        if (row) created.push(row);
      }
      return { folders: [...byPath.values()], created };
    },

    // The per-entity folder. Audrey, explicitly: five scenes means five
    // independent folders under SCENES/, not one shared one.
    //
    // Creates the category lazily too — a scene can exist from before the
    // toggle was flipped, and its folder must not be orphaned.
    async ensureEntityFolder(projectId, project, entityType, entity) {
      const client = await requireClient();
      const planned = planEntityFolder(project, entityType, entity);
      if (!planned) throw new Error(`[supabase] unknown folder entity type: ${entityType}`);
      const fk = ENTITY_FK_COLUMN[entityType];
      const byPath = await foldersByPath(client, projectId);

      // Renaming the entity MOVES its folder (folderPaths.js explains why),
      // and this is checked before anything is inserted. Matching on the FK
      // rather than the path is the whole point: the path is the thing that
      // changed, so a path lookup would miss the existing row and create a
      // second folder for one scene — the exact defect this session exists to
      // prevent. The database would refuse it (folders_scene_uniq), which is
      // the backstop, not the plan.
      const mine = [...byPath.values()].find(f => f[fk] && f[fk] === entity?.id);
      if (mine) {
        if (mine.path === planned.folder.path) return mine;
        return unwrap(await client.from('folders')
          .update({
            slug:  planned.folder.slug,
            path:  planned.folder.path,
            label: planned.folder.label,
          })
          .eq('id', mine.id).select().single());
      }

      // The root has to exist before a category can point at it, and a
      // project created before 0041 has no rows at all.
      if (!byPath.has('')) {
        for (const step of planProjectFolders(project)) {
          await insertFolderIfMissing(client, projectId, step, byPath);
        }
      }
      for (const step of [planned.category, planned.folder]) {
        await insertFolderIfMissing(client, projectId, step, byPath);
      }
      return byPath.get(planned.folder.path) || null;
    },

    // The project manifest — a generated MIRROR of the project's settings,
    // written into the project folder so the folder is self-describing
    // (Audrey, 2026-08-03). See projectManifest.js for what it deliberately
    // leaves out and the storage policy that forced that.
    //
    // upsert: true, unlike uploadFile. Every other upload is a distinct user
    // file and a collision means two files; this one is a regenerated mirror
    // and a collision means the newer copy wins, which is exactly right.
    //
    // 🚨 THAT upsert DID NOT WORK UNTIL MIGRATION 0042 (Session 27), and the
    // failure was invisible. Supabase Storage implements upsert-over-an-
    // existing-object as an UPDATE on storage.objects, and this bucket had no
    // UPDATE policy at all — 0027 created SELECT/INSERT/DELETE and nothing
    // since had added one. So the FIRST write of a project's manifest
    // succeeded and every write after it was refused, for the life of the
    // project. RabbitProvider.writeManifestSoon caught the throw and logged
    // "the manifest is a mirror and is rewritten on the next change", which
    // was never going to happen. Measured with a rolled-back probe before
    // 0042 was written; pgTAP 53 probe 6 is the regression test.
    //
    // No `files` row is created, on purpose. The manifest is not a user's
    // file — showing it in the Files list would invite someone to edit or
    // delete the thing the folder describes itself with, and its lifecycle is
    // "rewritten whenever settings change", which the file lifecycle (0027)
    // does not model.
    async writeProjectManifest(projectId, manifest) {
      const client = await requireClient();
      const body = new Blob([serializeProjectManifest(manifest)], { type: 'application/json' });
      const { error } = await client.storage.from('rabbit-files').upload(
        `projects/${projectId}/${MANIFEST_FILENAME}`, body,
        { upsert: true, contentType: 'application/json', cacheControl: '0' },
      );
      if (error) {
        lastError = error.message;
        throw new Error(`[supabase] manifest write failed: ${error.message}`);
      }
      return { path: `projects/${projectId}/${MANIFEST_FILENAME}` };
    },

    // The rates mirror — the third thing Audrey asked for on 2026-08-03 and
    // the one S26 had to leave out, because PROJECT.json is readable by every
    // project member and these figures are manager-only.
    //
    // 🚨 THE PATH IS THE GATE. projectRatesPath puts this under the FINANCE
    // segment, which public.rabbit_money_segment() classifies as money-gated,
    // which makes the four rabbit_files_money_* policies apply and the three
    // base ones NOT apply. Write this to any other prefix and it becomes
    // world-readable within the project — silently, with no error, because
    // the base insert policy would happily accept it. See projectRates.js.
    //
    // Nothing here checks whether the caller is a manager, and that is
    // deliberate: RLS is the authority. A non-manager reaching this gets a
    // storage refusal from rabbit_files_money_insert, which is the same answer
    // by a mechanism that cannot be bypassed by calling the adapter directly.
    async writeProjectRates(projectId, mirror) {
      const client = await requireClient();
      const path = projectRatesPath(projectId);
      const body = new Blob([serializeProjectRates(mirror)], { type: 'application/json' });
      const { error } = await client.storage.from('rabbit-files').upload(
        path, body,
        { upsert: true, contentType: 'application/json', cacheControl: '0' },
      );
      if (error) {
        lastError = error.message;
        throw new Error(`[supabase] rates mirror write failed: ${error.message}`);
      }
      return { path };
    },

    async deleteFolder(id, _projectId) {
      const client = await requireClient();
      // Descendants go with it via parent_id ON DELETE CASCADE (0041).
      // 🚨 This is NOT what a category toggle calls. Toggling scenes_enabled
      // off hides the tab and deletes nothing — Audrey's stated requirement,
      // pinned by pgTAP 52 probe 17. This is for a folder a user removes on
      // purpose.
      unwrap(await client.from('folders').delete().eq('id', id));
    },

    // ── Milestones (tables pending — Phase 2) ───────────────
    async upsertMilestone() { throw new Error('[supabase] milestones table not yet created — use local_server adapter'); },
    async deleteMilestone() { throw new Error('[supabase] milestones table not yet created — use local_server adapter'); },

    // ── Realtime (Session 7, migration 0016) ──────────────────
    // Joins the private broadcast channel `rabbit:project:{id}` fed by the
    // fn_realtime_broadcast trigger. Events are normalized for the pure
    // merge layer (state/realtimeMerge.js):
    //   callback({ table, op: 'INSERT'|'UPDATE'|'DELETE', record, oldRecord })
    //
    // opts:
    //   onStatus(status)      — channel lifecycle ('SUBSCRIBED', 'CLOSED',
    //                           'CHANNEL_ERROR', 'TIMED_OUT'); the provider
    //                           refetches after a re-subscribe to close the
    //                           missed-events window.
    //   onPresence(users)     — flattened presence list [{ user_id, label }];
    //                           enables presence tracking when provided.
    //
    // Returns an unsubscribe function; always safe to call.
    subscribeProjectChanges(projectId, callback, opts = {}) {
      let cancelled = false;
      let channel = null;
      let client = null;

      (async () => {
        client = await getClient();
        if (!client || cancelled) return;

        // Private channels authorize against realtime.messages RLS with the
        // caller's JWT — make sure the realtime socket carries it. Recent
        // supabase-js versions do this on auth change; this is the cheap
        // defensive path for a socket opened before sign-in finished.
        try { await client.realtime.setAuth(); } catch { /* non-fatal */ }
        if (cancelled) return;

        let presenceMeta = null;
        if (opts.onPresence) {
          try {
            const { data } = await client.auth.getSession();
            const user = data?.session?.user;
            if (user) {
              presenceMeta = {
                user_id: user.id,
                label: user.user_metadata?.display_name
                    || user.user_metadata?.username
                    || user.email
                    || 'Member',
              };
            }
          } catch { /* presence stays anonymous-less; channel still works */ }
        }
        if (cancelled) return;

        channel = client.channel(`rabbit:project:${projectId}`, {
          config: {
            private: true,
            ...(presenceMeta ? { presence: { key: presenceMeta.user_id } } : {}),
          },
        });

        for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
          channel.on('broadcast', { event: op }, (msg) => {
            const p = msg?.payload;
            if (!p || !p.table) return;
            callback({
              table:     p.table,
              op:        p.operation || op,
              record:    p.record ?? null,
              oldRecord: p.old_record ?? null,
            });
          });
        }

        if (opts.onPresence) {
          channel.on('presence', { event: 'sync' }, () => {
            try {
              const state = channel.presenceState();
              const users = Object.values(state).flat()
                .map(m => ({ user_id: m.user_id, label: m.label }))
                // "Who ELSE has this project open" — the caller's own
                // tracked meta comes back in the sync state; showing a
                // chip to a solo user would fake a teammate.
                .filter(u => u.user_id && u.user_id !== presenceMeta?.user_id);
              opts.onPresence(users);
            } catch { /* presence display is best-effort */ }
          });
        }

        channel.subscribe(async (status) => {
          if (cancelled) return;
          try { opts.onStatus?.(status); } catch { /* observer errors stay theirs */ }
          if (status === 'SUBSCRIBED' && presenceMeta) {
            try { await channel.track(presenceMeta); } catch { /* best-effort */ }
          }
        });
      })();

      return () => {
        cancelled = true;
        if (channel) {
          try { channel.unsubscribe(); } catch { /* already down */ }
          try { client?.removeChannel?.(channel); } catch { /* already gone */ }
        }
      };
    },

    // ── Workspace realtime (Session 8, migration 0018) ────────
    // Joins the private broadcast channel `rabbit:workspace:{id}` fed by
    // fn_workspace_realtime_broadcast — projects (index liveness),
    // workspace_members (roster/avatar liveness) and assigned tasks
    // (Dashboard liveness). Same event shape and lifecycle contract as
    // subscribeProjectChanges; presence here means "who's online in the
    // workspace" and is keyed by auth user id like the project channel.
    subscribeWorkspaceChanges(workspaceId, callback, opts = {}) {
      let cancelled = false;
      let channel = null;
      let client = null;

      (async () => {
        client = await getClient();
        if (!client || cancelled || !workspaceId) return;

        // Private channels authorize against realtime.messages RLS with the
        // caller's JWT — make sure the realtime socket carries it.
        try { await client.realtime.setAuth(); } catch { /* non-fatal */ }
        if (cancelled) return;

        let presenceMeta = null;
        if (opts.onPresence) {
          try {
            const { data } = await client.auth.getSession();
            const user = data?.session?.user;
            if (user) {
              presenceMeta = {
                user_id: user.id,
                label: user.user_metadata?.display_name
                    || user.user_metadata?.username
                    || user.email
                    || 'Member',
              };
            }
          } catch { /* presence stays anonymous-less; channel still works */ }
        }
        if (cancelled) return;

        channel = client.channel(`rabbit:workspace:${workspaceId}`, {
          config: {
            private: true,
            ...(presenceMeta ? { presence: { key: presenceMeta.user_id } } : {}),
          },
        });

        for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
          channel.on('broadcast', { event: op }, (msg) => {
            const p = msg?.payload;
            if (!p || !p.table) return;
            callback({
              table:     p.table,
              op:        p.operation || op,
              record:    p.record ?? null,
              oldRecord: p.old_record ?? null,
            });
          });
        }

        if (opts.onPresence) {
          channel.on('presence', { event: 'sync' }, () => {
            try {
              const state = channel.presenceState();
              const users = Object.values(state).flat()
                .map(m => ({ user_id: m.user_id, label: m.label }))
                // "Who ELSE is online" — filter the local user like the
                // project channel does.
                .filter(u => u.user_id && u.user_id !== presenceMeta?.user_id);
              opts.onPresence(users);
            } catch { /* presence display is best-effort */ }
          });
        }

        channel.subscribe(async (status) => {
          if (cancelled) return;
          try { opts.onStatus?.(status); } catch { /* observer errors stay theirs */ }
          if (status === 'SUBSCRIBED' && presenceMeta) {
            try { await channel.track(presenceMeta); } catch { /* best-effort */ }
          }
        });
      })();

      return () => {
        cancelled = true;
        if (channel) {
          try { channel.unsubscribe(); } catch { /* already down */ }
          try { client?.removeChannel?.(channel); } catch { /* already gone */ }
        }
      };
    },
  };
}
