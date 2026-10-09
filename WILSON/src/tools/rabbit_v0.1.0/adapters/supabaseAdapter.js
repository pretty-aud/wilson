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
// Post-overhaul S4c: a shot's folder sits in its scene's, and the one-time
// re-filing of a project's older shot folders (the pure rule lives there).
import {
  pendingShotRefiling, shotsCategoryRow, shotObjectPrefix, nestedShotKey,
} from '../shotRefiling';
import { THUMBNAIL_BUCKET } from '../storage/thumbnails';
import { hasLocalServer } from '../../../lib/localData';
import { serializeProjectManifest, MANIFEST_FILENAME } from '../projectManifest';
import { splitSetAside, isSetAside } from '../state/setAside';
// Session 36: the storage provider registry (NETWORK_STORAGE_DESIGN.md §4a2b).
// Session 37: the workspace's CONFIGURED provider decides where a new body
// goes (activeWorkspaceProvider over the cached workspace_storage row); 's3'
// is an entry in the registry, not a branch here — exactly as promised.
import {
  WORKSPACE_PROVIDERS,
  FILE_PROVIDERS,
  fileProviderFor,
  activeWorkspaceProvider,
  registerStorageProvider,
  getStorageProvider,
  resolveFileProvider,
} from '../storage';
import { createSupabaseStorageProvider } from '../storage/supabaseProvider';
import { createS3StorageProvider } from '../storage/s3Provider';
import { createLocalServerStorageProvider } from '../storage/localServerProvider';
import { describeSourceFile } from '../storage/mediaMetadata';
import {
  generateThumbnail, thumbnailKeyFor, putThumbnailTo, removeThumbnailFrom,
  signedThumbnailUrls,
} from '../storage/thumbnails';
// Session 40: the video decoder is a SEPARATE entry point, not an option on
// generateThumbnail — canThumbnail() refuses video deliberately and two guard
// tests pin that refusal. See storage/videoThumbnails.js for why.
import {
  looksLikeVideoFile, generateVideoThumbnailFromFile,
} from '../storage/videoThumbnails';
import { getWorkspaceStorageCached } from '../../../cloud/workspaceStorage';
import { presignStorage } from '../../../cloud/storageApi';
import { serializeProjectRates, projectRatesPath } from '../projectRates';
import {
  LEGAL_SEGMENT, LEGAL_UNAVAILABLE, LEGAL_GATE_REFUSAL,
  LEGAL_NOT_CORE_REASON, legalRefusalSentence,
} from '../fileTags';

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
  // 🚨 0084: shotListsAbsent is deliberately NOT cleared here (S3a review R1,
  // cloud#0). RabbitProvider calls this on EVERY Supabase auth event — the
  // hourly TOKEN_REFRESHED, and the SIGNED_IN auth-js emits on each
  // hidden-to-visible switch — and then reloads only the project LIST, never
  // the project. Clearing the flag here re-armed the 0084 columns on a
  // database without them, and every Timeline task save (it always sends
  // scene_id / shot_id) PGRST204'd after a token refresh. An auth event does
  // not change the schema: there is one database per build. Only a
  // successful read of shot_lists clears it (probeShotLists), and tests use
  // resetShotListSchemaState(). localMediaWiring.test.js pins
  // `fileMetaKnown = null;` as this function's LAST line, right after
  // `privateColumnKnown = null;` — so 0085's probe (S4a) is forgotten first.
  legalFilesKnown = false;
  fileTagsKnown = null;
  privateColumnKnown = null;
  fileMetaKnown = null;
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
// list — that was precisely the mistake useRosterMembers made until B1, where
// a broken RPC and an empty workspace were indistinguishable at every call
// site (it returns `error` now).
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

// Session 37: the S3-compatible provider — presign-then-fetch, with the
// authorisation boundary and the secret both server-side (storage-presign).
// Registered here, beside supabase, so resolveFileProvider can serve an
// 's3' row the moment one exists.
registerStorageProvider(
  FILE_PROVIDERS.S3,
  createS3StorageProvider(presignStorage),
);
// Demo 2026-09-11: the desktop's own disk, for PRIVATE projects (see
// uploadFile). Registered on EVERY surface so a row that names it resolves
// to a sentence off the desktop (localServerProvider.js NOT_HERE) instead of
// the registry's "no storage provider registered".
registerStorageProvider(
  FILE_PROVIDERS.LOCAL_SERVER,
  createLocalServerStorageProvider(),
);

// ── Demo 2026-09-11: private projects — cloud rows, media on this computer ──
// Migration 0072 adds projects.is_private. The column is PROBED once per
// session rather than assumed, so a client ahead of the database (staging
// before the push, an older environment) shows no checkbox and lists
// projects exactly as before, instead of failing every list on 42703.
let privateColumnKnown = null; // null = not probed yet
async function privateProjectsAvailable(client) {
  if (privateColumnKnown !== null) return privateColumnKnown;
  const { error } = await client.from('projects').select('is_private').limit(1);
  if (!error) { privateColumnKnown = true; return true; }
  if (error.code === '42703' || /is_private/.test(error.message || '')) {
    privateColumnKnown = false;
    return false;
  }
  // Any other failure (network, RLS) says nothing about the column: answer
  // "not now" and probe again next time.
  return false;
}
// Demo 2026-09-11 (Audrey: "the name of the file, file type, creation date
// and time, file size, if its an audio or video file the duration as well"):
// files.duration_sec / files.source_modified_at arrive with migration 0081
// and are probed the same way — a client ahead of the database writes the
// row exactly as before.
let fileMetaKnown = null;
async function fileMetaAvailable(client) {
  if (fileMetaKnown !== null) return fileMetaKnown;
  const { error } = await client.from('files').select('duration_sec').limit(1);
  if (!error) { fileMetaKnown = true; return true; }
  if (error.code === '42703' || /duration_sec/.test(error.message || '')) {
    fileMetaKnown = false;
    return false;
  }
  return false;
}
// Post-overhaul S4a: files.tags arrives with migration 0085 and is probed the
// same way, so the beta keeps working on a database Audrey has not migrated
// yet: the file window hides the tag chips (supportsFileTags) and updateFile
// strips `tags` from a patch rather than letting PGRST204 take the whole
// request — a note typed beside a tag still saves.
let fileTagsKnown = null;
async function fileTagsAvailable(client) {
  if (fileTagsKnown !== null) return fileTagsKnown;
  const { error } = await client.from('files').select('tags').limit(1);
  if (!error) { fileTagsKnown = true; return true; }
  // The missing-column sentence itself, not any message with the word
  // "tags" in it (review round 1, R1-SEC-05): "absent" is remembered for the
  // session, and a wrong "absent" drops every tag write — the silent loss
  // this probe exists to prevent. `tags` is an ordinary word, unlike 0081's
  // `duration_sec`.
  if (error.code === '42703' || /column\s+(?:"?\w+"?\.)?"?tags"?\s+does not exist/i.test(error.message || '')) {
    fileTagsKnown = false;
    return false;
  }
  // Any other failure (network, RLS) says nothing about the column: answer
  // "not now" and probe again next time.
  return false;
}
// Post-overhaul S4b: Legal files need migration 0088 — LEGAL in the one list
// of locked folders (public.rabbit_money_segment) and the legal-tag CHECK. The
// probe asks the database the question that matters, by calling the list
// itself: IS the LEGAL folder locked here? Before 0088 it is an ordinary
// folder, and a "Legal" upload would land where every project member can read
// it. So only a positive `true` counts; false, an error or no answer means
// "not offered", and only `true` is remembered (a database migrated
// mid-session is picked up on the next ask).
// S4d (0092): and the Legal GATE must be there too — can_access_project_legal,
// asked with the nil uuid (a project nobody has: it answers false where the
// function exists and "no such function" where it does not). A database with
// 0088 but not 0092 locks the folder for the money audience only; Add as
// Legal is greyed there with LEGAL_UNAVAILABLE naming both migrations, and a
// Legal upload is refused by the same sentence — not by the gate's, which
// would tell a project manager they are not one (review round 1, finding 8).
const NIL_PROJECT_ID = '00000000-0000-0000-0000-000000000000';
let legalFilesKnown = false;
async function legalFilesAvailable(client) {
  if (legalFilesKnown) return true;
  try {
    const { data, error } = await client.rpc('rabbit_money_segment', { seg: LEGAL_SEGMENT });
    if (error || data !== true) return false;
    const gate = await client.rpc('can_access_project_legal', { p_project: NIL_PROJECT_ID });
    if (gate?.error) return false;
    legalFilesKnown = true;
  } catch { /* not now */ }
  return legalFilesKnown;
}
// The Legal gate itself (0092's can_access_project_legal — the money gate OR
// a workspace manager of the project's own workspace, with 0072's privacy
// arm; executable by authenticated), asked before a Legal upload moves a
// byte: the database would refuse the object and the row anyway, but only
// after the transfer. Until 0092 this asked the money gate. Fails CLOSED —
// an error, a null or anything but `true` is a no (legalFilesAvailable has
// already said the function exists, so a no here is the gate's own answer).
async function canAccessProjectLegal(client, projectId) {
  try {
    const { data, error } = await client.rpc('can_access_project_legal', { p_project: projectId });
    return !error && data === true;
  } catch {
    return false;
  }
}
async function projectIsPrivate(client, projectId) {
  if (!(await privateProjectsAvailable(client))) return false;
  const { data, error } = await client
    .from('projects').select('is_private').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`[supabase] ${error.message}`);
  return !!data?.is_private;
}

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
  // 0084 (D9) — the scene / shot a task is for. TimelineView's task editor
  // has sent both on every save since S23 (`draft.scene_id || null`,
  // TimelineView.jsx:4355-4356) and they were dropped here with a warning,
  // because 0034 left them local-only. 0084 gives them same-project FKs, so
  // the column and this entry are ONE change. level_id / experience_id stay
  // OUT: the editor sends them too, but 0084's header keeps them local-only
  // (D9 names scene and shot only), so they keep being dropped and warned.
  // 🚨 Stripped again on a database without 0084 — see stripUnmigrated.
  'scene_id', 'shot_id',
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
  // 0084 (D9) — the scenes / shots an asset appears in, as uuid[] (NOT NULL
  // DEFAULT '{}'). ProjectAssetsView's relation pickers have sent whole
  // arrays (`updateAsset(id, { scene_ids: next })`, ProjectAssetsView.jsx
  // :2026 / :2040) and were dropped here until now. An array is not an FK, so
  // a deleted scene's id can linger; the client ignores unknown ids (0084 §6c).
  // level_ids / experience_ids stay OUT, like the task links above.
  // 🚨 Stripped again on a database without 0084 — see stripUnmigrated.
  'scene_ids', 'shot_ids',
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
  // 0072 (demo 2026-09-11) — a private project: visible to its creator and
  // to admins, media on the creator's computer. createProject drops it where
  // the column has not landed yet (privateProjectsAvailable).
  'is_private',
  // 0084 (D10) — the project's ACTIVE shot list. It is here so a whole-row
  // re-send carrying the pointer UNCHANGED passes (trg_projects_active_shot_
  // list_guard compares IS DISTINCT FROM, the 0049 rule). A CHANGE through
  // updateProject is refused by that guard (42501): the one writer is
  // set_active_shot_list(), reached through setActiveShotList below (D8).
  // 🚨 Stripped again on a database without 0084 — see stripUnmigrated.
  'active_shot_list_id',
  // 0089 (post-overhaul S5, F2) — the project's OPEN bid version: the one
  // whose data the live Timeline and Budget hold and Save writes back into.
  // Written by updateProject; trg_projects_open_budget_version_guard refuses
  // a CHANGE from anyone not past the money gate (a member passes
  // projects_update but not can_access_project_money), and an unchanged
  // pointer re-sent with a whole row always passes. createProject drops it:
  // a new project has no versions (the same-project FK would refuse one).
  // 🚨 The S5 client needs 0089 on its database (see the S5 hand-off, "For
  // the beta"): a write naming this column on a database without it is
  // refused PGRST204.
  'open_budget_version_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
]);

// ── 0040: the four entity tables ─────────────────────────────────────────
// Every one of these needs an allowlist entry, not because of the columns it
// HAS but because of the keys the UI sends that are not columns:
//   * addLevel / addExperience send `files` — an array of picked files from
//     the create dialog (EntityListView.jsx:1159). It has no column and belongs
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

// ── 0067: milestones ─────────────────────────────────────────────────────
// The columns TimelineView's editor actually writes for mode 'milestone'
// ({ title, date, color, description, phase_id }) plus the id/project spine
// and the workspace/audit columns every RABBIT row carries.
//
// `workspace_id` is here for the same reason it is on SCENE_COLUMNS: the
// provider re-sends whole rows on update. `deleted_at` / `deleted_by` are NOT:
// a client never writes them — the two trash RPCs do, as definer — and
// admitting them would let a plain upsert set deleted_at, which
// milestones_update would then refuse with an RLS violation rather than a
// message anyone can read.
//
// `isProjectBound` is not a column and is not meant to be: TimelineView
// synthesizes project-start/end markers with that flag and refuses to open the
// editor on them, so one can never reach a write. toColumns drops it if a
// future affordance ever does.
const MILESTONE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'phase_id',
  'title', 'date', 'color', 'description', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

// ── 0084 (post-overhaul S3a): shot lists, their membership, edits ────────
// Exactly the three tables' columns — the S3a contract's row shapes, which
// every backend returns. These say what the TABLE has; they are not what an
// upsert sends.
//
// 🚨 upsertShotList / upsertEdit strip SHOT_LIST_SERVER_OWNED (the four
// audit columns and archived_at / archived_by) BEFORE toColumns — S3a review
// R1, cloud#3 + cloud#4. The provider re-sends whole rows, and forwarding
// created_by rewrote the backfilled list's NULL creator to whoever renamed it
// first (fn_audit_touch stamps the proposed row, merge-duplicates writes
// EXCLUDED); forwarding a stale archived_at: null answered a rename of a list
// someone else archived with "…archived and restored only by a project
// manager…" instead of "this shot list is archived — restore it before
// changing it". Unsent, none of the six is in the conflict update's SET list:
// created_* and archived_* keep their stored values, fn_audit_touch stamps
// updated_* itself, and the guard's frozen-row arm answers for an archived
// row. (Not yet the other two backends' answer to a STALE copy carrying
// archived_at: null — they compare the archive columns first and answer the
// 403 sentence; r2 closure#9 / parity2#3.) Archiving stays
// archive_shot_list() / archive_edit()'s alone.
//
// Membership rows are never upserted through PostgREST directly: the deltas
// go through upsert_shot_list_items() (its positions-only arm for a reorder)
// and a filtered DELETE, the whole-set swap through replace_shot_list_items().
// The allowlist is here so any future direct write is filtered, not passed
// through (the S23 hole).
//
// 🚨 An edit's `items` is ONE jsonb column (0084 §5, the 0044 precedent):
// toColumns never sees the item keys ({ id, scene_id, shot_id, label, notes })
// and must not — adding a field to an edit ITEM needs no change here.
const SHOT_LIST_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id',
  'title', 'version', 'summary', 'snapshot',
  'archived_at', 'archived_by',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const SHOT_LIST_ITEM_COLUMNS = new Set([
  'id', 'shot_list_id', 'project_id', 'workspace_id',
  'scene_id', 'shot_id', 'position',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const EDIT_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'shot_list_id',
  'title', 'version', 'summary', 'parent_edit_id', 'items', 'snapshot',
  'archived_at', 'archived_by',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

// ── 0091 (Bins on the cloud, BC1): locations, bins, bin files, takes ─────
// Exactly the four tables' columns — the row shapes every backend returns
// (electron/rabbitBins.cjs for the signed-out desktop, with `source_path` in
// place of location_id + relative_path and `binRoots` beside them). These say
// what the TABLE has; `online` is NEVER a column (it is a fact about the
// computer reading the row — updateBinFile strips it silently, without the
// S23 warning, because it is a computed flag and not a person's input).
//
// 🚨 bin_files.poster_path is the key of the clip's picture in
// rabbit-thumbnails; a row may only name a key under its own project's
// bin_files prefix (0091's CHECK), and the upload itself lands only while the
// workspace's remote_viewing_enabled is on (B4, the RESTRICTIVE policies) —
// postBinFileThumbnail asks the switch first so the person reads a sentence,
// not a storage error.
const BIN_LOCATION_COLUMNS = new Set([
  'id', 'workspace_id', 'name', 'unc_path',
  'added_by', 'created_at', 'updated_at',
]);

const BIN_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id',
  'name', 'description', 'kind', 'color', 'parent_bin_id', 'sort_order',
  'created_at', 'created_by', 'updated_at', 'updated_by',
]);

const BIN_FILE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'bin_id', 'location_id', 'relative_path',
  'display_name', 'original_name', 'extension', 'mime_type',
  'is_sequence', 'sequence_pattern', 'frame_count', 'size_bytes', 'mtime',
  'media_type', 'tags', 'scene_id', 'shot_id',
  'slate', 'take_number', 'take_modifier', 'camera', 'roll', 'shoot_day',
  'description', 'notes', 'review_flag', 'circled', 'color',
  'duration_sec', 'width', 'height', 'fps', 'codec', 'timecode_start',
  'probe_status', 'sort_order', 'poster_path',
  'added_by', 'added_at', 'updated_at',
]);

const SHOT_TAKE_COLUMNS = new Set([
  'id', 'project_id', 'workspace_id', 'shot_id', 'bin_file_id',
  'role', 'position', 'notes',
  'created_at', 'updated_at',
]);

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
  // 0084 — the shot list this version was built against (same-project
  // composite FK, SET NULL) and the version's summary (question F8, nullable,
  // nothing writes it yet). upsertBudgetVersion is whole-row (BudgetView
  // spreads `{ ...v, is_active }`), so both ride along on every activate and
  // rename once a row carries them — which is why they must be columns here
  // and not strays the allowlist warns about.
  // 🚨 Stripped again on a database without 0084 — see stripUnmigrated.
  'shot_list_id', 'summary',
  // Post-overhaul S5: an UNDONE delete re-inserts the version with its own
  // created_at, so it keeps its place newest-first and stays the "version
  // before" F8's automatic line is computed against. A NEW version sends none
  // (RabbitProvider.createBudgetVersion): the server's default stamps it.
  'created_at',
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
  // 0075 (Track C, C3). ProjectFilesTable's Kind select and Description cell
  // have written these two on every gesture since S27 and the cloud had
  // neither column, so toColumns stripped both and the optimistic
  // setCloudFiles() hid the no-op until the next listFiles(). The migration
  // and these two names are ONE change: either alone still loses the write.
  // MASTER_PLAN §6 #31 trap (a).
  'document_kind', 'description',
  'uploaded_at',
  // 0081 (demo 2026-09-11) — the file's own duration and modified time.
  'duration_sec', 'source_modified_at',
  // 0085 (post-overhaul S4a) — the nine tags (Audrey's E3). Probed before
  // every write that carries it (fileTagsAvailable): a client ahead of the
  // database strips it instead of PGRST204-ing the whole patch.
  'tags',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
]);

// ── Phase 2 of the 2026-08-10 build pass (migration 0061) ───────────────
// The LAST write path still on the raw `sanitize(dep, [])` denylist, and the
// one this whole defect class was named after. Audrey, 2026-08-10: "i was able
// to grab the line from the dependency task but i could not attach it to
// another this is crucial to work."
//
// THREE non-columns reach this table, not one:
//   * `kind`       — RabbitProvider.linkTasks/linkPhases stamp 'task'/'phase'.
//                    It is a client-side RENDER discriminator (DetailPane's
//                    `const kind = d.kind || 'task'`), never a column. The
//                    adapter re-derives it on read from WHICH TABLE the row
//                    came from, so dropping it on write loses nothing.
//   * `project_id` — needed by localServerAdapter, which interpolates it into
//                    the URL (`/projects/${dep.project_id}/dependencies`).
//                    🚨 That is why it is stripped HERE and not at the row
//                    construction site: deleting it in RabbitProvider would
//                    POST to /projects/undefined/dependencies and break every
//                    desktop dependency write.
//   * `predecessor`— the embed object loadProject's select adds to every row it
//                    returns. Nothing stripped it, so undo-after-reload re-sent
//                    it and PGRST204'd all over again. A fix that only removed
//                    `kind` and `project_id` would still have left undo broken
//                    on any dependency the user did not create this session.
//
// Both dependency tables share this set — 0061 gives phase_dependencies the
// same column shape as its sibling deliberately, so the adapter can route by
// kind without a second vocabulary.
const DEPENDENCY_COLUMNS = new Set([
  'id', 'predecessor_id', 'successor_id', 'type', 'lag_days',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
]);

// Which table a given edge lives in. Exported so dependencyRouting.test.js can
// assert the EXECUTABLE mapping rather than a restatement of it.
export const DEPENDENCY_TABLE = {
  task:  'task_dependencies',
  phase: 'phase_dependencies',
};

// Anything that is not literally 'phase' is a task edge. Matches DetailPane's
// `const kind = d.kind || 'task'` exactly — a row loaded before 0061, or one
// written by a client that never set the field, is a task edge.
export function dependencyKind(dep) {
  return dep?.kind === 'phase' ? 'phase' : 'task';
}

export const COLUMN_ALLOWLIST = {
  tasks: TASK_COLUMNS,
  files: FILE_COLUMNS,
  task_dependencies:  DEPENDENCY_COLUMNS,
  phase_dependencies: DEPENDENCY_COLUMNS,
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
  milestones: MILESTONE_COLUMNS,
  shot_lists: SHOT_LIST_COLUMNS,
  shot_list_items: SHOT_LIST_ITEM_COLUMNS,
  edits: EDIT_COLUMNS,
  // 0091 (BC1): the four bins tables.
  bin_locations: BIN_LOCATION_COLUMNS,
  bins: BIN_COLUMNS,
  bin_files: BIN_FILE_COLUMNS,
  shot_takes: SHOT_TAKE_COLUMNS,
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
// `date` is milestones' own column (0067) and the only bare `date` in the
// schema. It is here for the same reason as the others: a DATE column refuses
// an empty string with 22007, and an editor that clears a field sends ''.
const DATE_FIELDS = new Set(['purchase_date', 'start_date', 'end_date', 'due_date', 'locked_at', 'date']);

function blankDatesToNull(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (DATE_FIELDS.has(k) && out[k] === '') out[k] = null;
  }
  return out;
}

// ── 0084: a client AHEAD of its database ─────────────────────────────────
// `feat/multi-user-v1` auto-deploys the staging-backed beta on every push
// while migrations are applied by hand, so this client can meet a database
// without 0084 (the S3a brief: it "tolerates … from an older database the way
// 0081's probe does"). Two things would break there, each with its own answer:
//
//   1. The widened allowlists would send scene_id / shot_id / scene_ids /
//      shot_ids / shot_list_id / summary / active_shot_list_id to tables that
//      lack them, and ONE unknown column PGRST204s the WHOLE write. TimelineView
//      sends scene_id on every task save, so every task save would die. While
//      0084 is known absent, stripUnmigrated removes exactly those columns from
//      every write of those four tables (it runs inside toColumns, the
//      chokepoint every one of those writes already passes, plus createProject,
//      the one project write that never ran toColumns).
//   2. The shot-list write methods have no table or RPC to reach. They refuse
//      with ONE clear Error, code `shot_lists_unavailable`, instead of a
//      PostgREST sentence about a schema cache.
//
// NO EXTRA REQUEST: loadProject already reads public.shot_lists, and a 42P01 /
// PGRST205 there IS the probe (0081's fileMetaAvailable needs its own
// .limit(1) read; this does not). A successful read clears the flag, so a
// database migrated mid-session is picked up by the next load. Until a load
// has answered, the flag is false and writes carry the 0084 columns they are
// given (before 0084 the allowlists dropped them). On an older database a
// write that carries one BEFORE the first project load is therefore refused
// with PGRST204; the task / asset / budget editors that send them all live
// inside an opened project, whose load answers the question first.
//
// 🚨 NOT cleared by resetSupabaseAdapter (review R1, cloud#0 — see there):
// auth events call that, and they do not change the schema.
let shotListsAbsent = false;

// For tests only: forget what the last load learned about 0084, the one piece
// of module state resetSupabaseAdapter keeps on purpose. The app never needs
// it — a load that finds shot_lists clears the flag by itself.
export function resetShotListSchemaState() {
  shotListsAbsent = false;
}

const COLUMNS_ADDED_BY_0084 = {
  tasks:           ['scene_id', 'shot_id'],
  assets:          ['scene_ids', 'shot_ids'],
  budget_versions: ['shot_list_id', 'summary'],
  projects:        ['active_shot_list_id'],
};

// Whether losing this value loses anything. null, '' and [] do not — the
// database has no column to hold them — and TimelineView sends
// `scene_id: null` on every save, which must not warn every time.
function carriesValue(v) {
  if (v === undefined || v === null || v === '') return false;
  return !(Array.isArray(v) && v.length === 0);
}

function stripUnmigrated(table, row) {
  const cols = shotListsAbsent ? COLUMNS_ADDED_BY_0084[table] : null;
  if (!cols || !row || typeof row !== 'object') return row;
  const out = { ...row };
  const lost = [];
  for (const c of cols) {
    if (!(c in out)) continue;
    if (carriesValue(out[c])) lost.push(c);
    delete out[c];
  }
  // Loud, like toColumns: a user linked a task to a scene and the link was
  // not kept. Silence here would be the S23 sin in a new place.
  if (lost.length) {
    console.warn(
      `[supabase] this database does not have migration 0084 yet, so ` +
      `${lost.join(', ')} on public.${table} was NOT saved. The rest of the ` +
      `write proceeded.`
    );
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
  // 0084: the allowlist says what the CURRENT schema has; on a database that
  // loadProject found without 0084, the columns 0084 adds are removed too.
  // A no-op until then (and for every other table) — see stripUnmigrated.
  return stripUnmigrated(table, out);
}

// ── Dependency loading (migration 0061) ─────────────────────────────────
//
// Both edge tables, unioned into the one collection the views read, each row
// stamped with the `kind` its table implies.
//
// THREE things about this query are deliberate and each fixes a live defect:
//
//   1. THE EMBED HINT IS A CONSTRAINT NAME, NOT A TABLE NAME. Both tables have
//      TWO foreign keys to the same parent, so `tasks(project_id)` is ambiguous
//      and PostgREST answers PGRST201. It must be disambiguated by constraint.
//      0061 names phase_dependencies' FKs explicitly and asserts them in a
//      post-condition for this reason; task_dependencies' name is still the
//      auto-generated one from 0000 and is asserted there too.
//
//   2. THE EMBED IS STRIPPED FROM THE ROW. `predecessor` is not a column, and
//      RabbitProvider's undo path re-sends the loaded row verbatim
//      (`upsertDependency(oldRow)`). Leaving it on meant undo-of-unlink
//      PGRST204'd on any dependency the user had not created in that same
//      session — a bug that would have survived fixing `kind`/`project_id`
//      alone. toColumns strips it too; this is the belt to that braces, and it
//      keeps the bundle honest for anything that iterates keys.
//
//   3. NO `!inner`, DELIBERATELY — and this is a decision, not an oversight.
//      Both queries filter on a NON-inner embed, which in PostgREST filters the
//      EMBEDDED resource and not the top-level rows: the server left-joins, so
//      rows whose predecessor is in another project come back with
//      `predecessor: null` still attached. Since task_deps_select (0004, never
//      revised by 0013) scopes to the WORKSPACE rather than the project, this
//      collection is workspace-wide rather than project-scoped. That is a
//      PRE-EXISTING leak, it is invisible (every consumer — visibleDeps,
//      buildSchedule, selectCriticalPath — drops edges whose endpoints are not
//      in the current project's lookup), and `!inner` on the adjacent
//      task_links fetch shows the author knew the distinction.
//      🚨 It is NOT fixed here on purpose. Adding `!inner` to the task query
//      means combining a constraint-name HINT with a join modifier
//      (`tasks!task_dependencies_predecessor_id_fkey!inner`), a form that
//      appears NOWHERE else in this repo and therefore has never once been
//      executed against a real PostgREST. If that token order is rejected the
//      server answers PGRST100, the load fails, and this is the single query
//      that draws every dependency arrow in the product. Trading a harmless
//      invisible leak for an unproven syntax on the one path this whole phase
//      exists to repair is a bad trade. The leak is recorded in
//      docs/OUTSTANDING.md; fix it in its own change, where it can be verified
//      on its own.
function stampDependencyKind(rows, kind) {
  return (rows || []).map(({ predecessor: _embed, ...row }) => ({ ...row, kind }));
}

async function listDependenciesWith(client, projectId) {
  const [taskEdges, phaseEdges] = await Promise.all([
    // Byte-for-byte the query that has always run here, so this phase adds no
    // risk at all to the task-dependency path. Only the mapping below is new.
    client
      .from('task_dependencies')
      .select('*, predecessor:tasks!task_dependencies_predecessor_id_fkey(project_id)')
      .eq('predecessor.project_id', projectId)
      .then(unwrap)
      .catch(() => []),
    // unwrapOptionalTable and NO blanket catch. The beta auto-deploys on every
    // push while migrations are applied by hand, so there is a window where
    // this client knows about phase_dependencies and the database does not —
    // 42P01/PGRST205 is absorbed and the user sees "no phase edges yet", which
    // is true. Every OTHER error still throws.
    // 🚨 A trailing `.catch(() => [])` here would undo exactly that: this
    // helper's own doctrine (see unwrapOptionalTable's header) is that an RLS
    // refusal or a network fault must NOT look like an empty list. Adding the
    // catch back is the mistake that comment exists to prevent.
    client
      .from('phase_dependencies')
      .select('*, predecessor:phases!phase_dependencies_predecessor_id_fkey(project_id)')
      .eq('predecessor.project_id', projectId)
      .then(unwrapOptionalTable),
  ]);
  return [
    ...stampDependencyKind(taskEdges,  'task'),
    ...stampDependencyKind(phaseEdges, 'phase'),
  ];
}

// ── Folder-tree helpers (Session 26, migration 0041) ────────────────────
//
// Module-level rather than methods, because nothing else in this adapter uses
// `this` — one destructured `const { listFolders } = adapter` would break
// every method that leaned on it, silently and only at runtime.

// S4c review round 1: PostgREST answers at most `max_rows` rows a call
// (1,000 on Supabase) and says nothing about the rest. A list that has to
// be WHOLE — the folder tree, the files a move must take — is read page by
// page until a short page. The query is built afresh per page (a builder
// is single-use) and must carry a total order, so no row straddles two.
const READ_PAGE = 1000;
// `unwrapPage` reads one page's answer (unwrapOptionalTable by default; the
// bins' lists bring their own, which remember whether 0091 is there).
async function readAllPagesWith(makeQuery, unwrapPage) {
  const out = [];
  for (let from = 0; ; from += READ_PAGE) {
    const page = unwrapPage(await makeQuery().range(from, from + READ_PAGE - 1));
    out.push(...page);
    if (page.length < READ_PAGE) return out;
  }
}
async function readAllPages(makeQuery) {
  return readAllPagesWith(makeQuery, unwrapOptionalTable);
}

function listFoldersWith(client, projectId) {
  // unwrapOptionalTable: a client deployed ahead of 0041 shows no folders
  // rather than failing every project load. Same treatment 0040's tables got,
  // and for the same reason — the web build ships continuously. Paged (S4c
  // review round 1): `path` is unique per project, so it orders the pages.
  return readAllPages(() => client.from('folders').select('*')
    .eq('project_id', projectId).order('path'));
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

// ── S4c: the per-entity folder, module-level so the re-filing can call it ──
//
// The per-entity folder. Audrey, explicitly: five scenes means five
// independent folders under SCENES/, not one shared one. Creates the
// category lazily too — a scene can exist from before the toggle was
// flipped, and its folder must not be orphaned.
//
// S4c: a SHOT's folder nests in its scene's. The scene row is read here
// (this adapter's own way of finding it — one small query; the planner stays
// pure), the scene's folder is ensured first so its id is there to parent
// on, and the shot's row goes under the scene's ACTUAL path. An EXISTING row
// keeps the parent it has: a rename moves it within that parent, never
// across one, so a project from before S4c keeps its shot folders under
// SHOTS until refileShotFolders (below) moves the objects and the rows
// together — the only thing that re-parents a shot.
async function sceneRowFor(client, shot) {
  if (!shot || !shot.scene_id) return null;
  try {
    const { data } = await client.from('scenes').select('id, name').eq('id', shot.scene_id).maybeSingle();
    return data && data.id ? data : null;
  } catch {
    return null;
  }
}

/** The scene a shot belongs to, by the shot's id (uploadFile's key needs it). */
async function shotSceneId(client, shotId) {
  if (!shotId) return null;
  try {
    const { data } = await client.from('shots').select('scene_id').eq('id', shotId).maybeSingle();
    return data?.scene_id || null;
  } catch {
    return null;
  }
}

async function ensureEntityFolderWith(client, projectId, project, entityType, entity) {
  const scene = entityType === 'shot' ? await sceneRowFor(client, entity) : null;
  const planned = planEntityFolder(project, entityType, entity, scene);
  if (!planned) throw new Error(`[supabase] unknown folder entity type: ${entityType}`);
  const fk = ENTITY_FK_COLUMN[entityType];
  const byPath = await foldersByPath(client, projectId);
  const rows = [...byPath.values()];

  // Renaming the entity MOVES its folder (folderPaths.js explains why),
  // and this is checked before anything is inserted. Matching on the FK
  // rather than the path is the whole point: the path is the thing that
  // changed, so a path lookup would miss the existing row and create a
  // second folder for one scene — the exact defect this session exists to
  // prevent. The database would refuse it (folders_scene_uniq), which is
  // the backstop, not the plan.
  const mine = rows.find(f => f[fk] && f[fk] === entity?.id);
  if (mine) {
    const parentRow = mine.parent_id ? rows.find(f => f.id === mine.parent_id) : null;
    const keptPath = parentRow
      ? `${parentRow.path ? parentRow.path + '/' : ''}${planned.folder.slug}`
      : planned.folder.path;
    let renamed = mine;
    if (mine.path !== keptPath) {
      renamed = unwrap(await client.from('folders')
        .update({
          slug:  planned.folder.slug,
          path:  keptPath,
          label: planned.folder.label,
        })
        .eq('id', mine.id).select().single());
    }
    // The rows under it follow — a scene's shot folders since S4c (review
    // round 1, item 7): each re-pathed under its PARENT's path, walked by
    // parent_id (never by a path prefix, which would sweep up another
    // row's stale child), the parent before its children so the unique
    // path index never sees a child before its parent's new name — and on
    // EVERY pass, not only the renaming one, so a pass that stopped part
    // way, or an older build's rename that moved nothing, is finished the
    // next time the row is ensured (round 2, item 6).
    const byId = new Map(rows.map(f => [f.id, f]));
    byId.set(mine.id, { ...mine, path: keptPath, slug: planned.folder.slug });
    const queue = [mine.id];
    while (queue.length > 0) {
      const parentId = queue.shift();
      const parent = byId.get(parentId);
      for (const child of rows) {
        if (child.parent_id !== parentId || child.id === mine.id) continue;
        const want = `${parent.path}/${child.slug}`;
        if (child.path !== want) {
          unwrap(await client.from('folders').update({ path: want }).eq('id', child.id).select('id').maybeSingle());
          byId.set(child.id, { ...child, path: want });
        }
        queue.push(child.id);
      }
    }
    return renamed;
  }

  // The root has to exist before a category can point at it, and a
  // project created before 0041 has no rows at all.
  if (!byPath.has('')) {
    for (const step of planProjectFolders(project)) {
      await insertFolderIfMissing(client, projectId, step, byPath);
    }
  }
  await insertFolderIfMissing(client, projectId, planned.category, byPath);
  if (planned.parent) {
    const sceneRow = await ensureEntityFolderWith(client, projectId, project, 'scene', scene);
    if (sceneRow) {
      byPath.set(sceneRow.path, sceneRow);
      if (sceneRow.path !== planned.folder.parentPath) {
        planned.folder.parentPath = sceneRow.path;
        planned.folder.path = `${sceneRow.path}/${planned.folder.slug}`;
      }
    }
  }
  await insertFolderIfMissing(client, projectId, planned.folder, byPath);
  return byPath.get(planned.folder.path) || null;
}

// ── S4c: the one-time re-filing, cloud half ──────────────────────────────
//
// For each shot folder still under SHOTS whose shot has a scene
// (shotRefiling.pendingShotRefiling), in this order — and the order is the
// whole design: a stop anywhere leaves rows that say where every file this
// account can see IS, within one round trip of where it is:
//
//   1. the scene's folder row is ensured (no object moves for that);
//   2. the shot's rows are read WHOLE by the old key shape, paged
//      (filesUnderPrefix: PostgREST stops at 1,000 rows and says nothing),
//      and the shot is CHECKED before anything moves (refileShotPreflight):
//      a body in the customer's own bucket (s3 — there is no move for it
//      yet), a body on another computer (a private project's, off the
//      desktop), a live row whose body is at neither key, a folder row
//      already at the destination — any of these leaves the shot where it
//      is, with the reason, and not one object of it moved (review round 1,
//      item 6: a refusal found mid-shot split a shot across two prefixes
//      for good);
//   3. EVERY object is moved in its bucket and SEEN at its new key, and its
//      files row is rewritten AT ONCE (refileOneObject): the body first
//      (rabbit-files), then the row's storage_path; then its thumbnail
//      (rabbit-thumbnails — a thumbnail lives where its source lives, S44),
//      then the row's thumbnail_url. storage-gc's orphan scan deletes an
//      object no row names once it is 24h old, so no object is ever left
//      moved with its row still saying the old key for longer than one
//      round trip (round 1, item 1; the scan now also keeps an object whose
//      twin key a row names, _shared/shotKeys.ts). A row update that answers
//      an error, or no row — a row a teammate trashed meanwhile is invisible
//      to the update (files_select, 0014) — puts the object back, but only
//      after RE-READING the row, successfully, and only while it still
//      names the old key: an update that committed and lost its answer is
//      left as it committed, and when the read fails too nothing is moved
//      (round 2, item 4). An object already at its new key with nothing at
//      the old one is a move that landed on an earlier run and is counted
//      done; an object at BOTH keys is left alone and reported (a move
//      never overwrites and nothing here deletes). A thumbnail at neither
//      key is a derived picture: the row stops naming it rather than the
//      shot being held back;
//   4. the old prefix is read again: a live row still under it (an upload
//      that landed meanwhile) leaves the folder where it is, to be run
//      again; then, and only then, the folder row is re-parented, and the
//      update must answer the row.
//
// One run per project at a time in this tab (refilingNow); another tab's or
// another person's run meets the same checks per object, which is what makes
// two runs safe rather than a lock. The SHOTS category row goes only once no
// folder row sits under it, COUNTED in the database (never in a list that
// may be cut short), and "gone" is said only when the delete answers the row.
const BUCKET_FILES = 'rabbit-files';
const REFILE_FILE_COLUMNS = 'id, name, storage_path, storage_provider, thumbnail_url, shot_id, folder_id';
const refilingNow = new Set();

/**
 * Every files row this account can see whose body OR thumbnail still sits
 * under `prefix`, whole. The thumbnail too: a run that stopped between a
 * body's move and its thumbnail's leaves a row whose body is nested and
 * whose picture is not, and the next run must find it. A row in Recently
 * deleted is NOT seen (files_select, 0014: `deleted_at IS NULL`), so a
 * trashed file's body keeps its old key — which still works after a
 * restore, since nothing gates the `shots` segment either.
 */
function filesUnderPrefix(client, projectId, prefix) {
  const like = `${prefix}%`;
  return readAllPages(() => client.from('files')
    .select(REFILE_FILE_COLUMNS)
    .eq('project_id', projectId)
    .or(`storage_path.like.${like},thumbnail_url.like.${like}`)
    .order('id'));
}

async function objectExistsIn(bucket, key) {
  const slash = key.lastIndexOf('/');
  const dir = slash === -1 ? '' : key.slice(0, slash);
  const leaf = slash === -1 ? key : key.slice(slash + 1);
  const { data, error } = await bucket.list(dir, { search: leaf, limit: 100 });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  // `search` is a substring match: the leaf itself, not a neighbour that
  // contains it (round 1's mutant: `length > 0` saw “plate.exr.bak” as the
  // plate).
  return (data || []).some(o => o.name === leaf);
}

/** The store an object lives in: a bucket, or this computer's media root. */
function storeFor({ client, local, bucketName }) {
  if (local) {
    const provider = getStorageProvider(FILE_PROVIDERS.LOCAL_SERVER);
    return {
      name: 'this computer',
      exists: (key) => provider.exists(key),
      move: async (from, to) => {
        if (typeof provider.move !== 'function') throw new Error('its storage cannot move it');
        await provider.move(from, to);
      },
    };
  }
  const bucket = client.storage.from(bucketName);
  return {
    name: bucketName,
    exists: (key) => objectExistsIn(bucket, key),
    move: async (from, to) => {
      const { error } = await bucket.move(from, to);
      if (error) throw new Error(error.message);
    },
  };
}

async function moveObjectVerified(where, from, to, name) {
  const store = storeFor(where);
  const [atTo, atFrom] = await Promise.all([store.exists(to), store.exists(from)]);
  if (atTo) {
    if (!atFrom) return 'landed-earlier';
    throw new Error(`“${name}” exists at both its old and its new place in ${store.name}; both were left`);
  }
  if (!atFrom) throw new Error(`“${name}” is missing from ${store.name} (${from})`);
  try {
    await store.move(from, to);
  } catch (err) {
    throw new Error(`“${name}” could not be moved in ${store.name}: ${err?.message || err}`);
  }
  if (!(await store.exists(to))) throw new Error(`“${name}” did not arrive at ${to} in ${store.name}`);
  return 'moved';
}

/**
 * The row read again: `{ ok: true, row }` with what it names NOW (`row`
 * null when this account cannot see it), or `{ ok: false, error }` when
 * the read itself failed — which is NOT "not visible" (round 2, item 4:
 * postgrest-js answers a lost connection as `{ data: null, error }`).
 */
async function rereadFileRow(client, id) {
  const { data, error } = await client.from('files').select('id, storage_path, thumbnail_url').eq('id', id).maybeSingle();
  if (error) return { ok: false, error: error.message || String(error) };
  return { ok: true, row: data && data.id ? data : null };
}

/**
 * The row rewritten to say where its object now is. An error, or no row
 * answered (the update reached nothing this account can see), puts the
 * object back — but only after the row has been READ AGAIN, successfully,
 * and still names the old key (or cannot be seen at all): an update that
 * committed and lost its answer stays as it committed; a row someone else
 * changed meanwhile is left to them; and when the read fails too, nothing
 * is known, so nothing is moved — the object stays at its new key, the
 * shot is left with "run it again", and the next run finds it (the row
 * still old: landed earlier; the row new: done) while storage-gc keeps it
 * (its twin key is named either way).
 */
async function rewriteFileRow(client, row, column, from, to, putBack) {
  const up = await client.from('files').update({ [column]: to }).eq('id', row.id).select('id').maybeSingle();
  const failed = up.error
    ? up.error.message
    : (!up.data || !up.data.id ? 'its record is not visible to this account any more (trashed or removed meanwhile)' : null);
  if (!failed) return;
  const again = await rereadFileRow(client, row.id);
  if (!again.ok) {
    throw new Error(`“${row.name}” was moved to ${to} but its record could not be updated (${failed}) and could not be read back (${again.error}); run it again`);
  }
  const now = again.row;
  if (now && now[column] === to) return;
  if (!now || now[column] === from) {
    try {
      await putBack();
    } catch (back) {
      throw new Error(`“${row.name}” was moved to ${to} but its record could not be updated (${failed}) and it could not be moved back (${back?.message || back}); its record still says ${from}`);
    }
  }
  throw new Error(`“${row.name}” could not be re-filed: ${failed}`);
}

/** Everything that would stop a shot, found BEFORE its first object moves. */
async function refileShotPreflight(client, projectId, p, rows, folders, toPath) {
  const taken = folders.find(f => f && f.id !== p.folder.id && f.path === toPath);
  if (taken) throw new Error(`a folder already sits at ${toPath}`);
  const ctx = { projectId, sceneId: p.scene.id, shotId: p.shot.id };
  for (const row of rows) {
    const to = nestedShotKey(row.storage_path, ctx);
    const thumbTo = row.thumbnail_url ? nestedShotKey(row.thumbnail_url, ctx) : null;
    if (!to && !thumbTo) continue;
    if (row.storage_provider === FILE_PROVIDERS.S3) {
      throw new Error(`“${row.name}” is in your own bucket, which cannot be moved from here yet`);
    }
    const local = row.storage_provider === FILE_PROVIDERS.LOCAL_SERVER;
    if (local && !hasLocalServer()) {
      throw new Error(`“${row.name}” lives on the computer that holds this private project's media: run this from the desktop app there`);
    }
    if (to) {
      const store = storeFor({ client, local, bucketName: BUCKET_FILES });
      const [atFrom, atTo] = await Promise.all([store.exists(row.storage_path), store.exists(to)]);
      if (!atFrom && !atTo) throw new Error(`“${row.name}” is missing from ${store.name} (${row.storage_path})`);
      if (atFrom && atTo) throw new Error(`“${row.name}” exists at both its old and its new place in ${store.name}; both were left`);
    }
    if (thumbTo) {
      // A picture at neither key is cleared later, not refused; one at both
      // keys is the same refusal as a body at both.
      const store = storeFor({ client, local, bucketName: THUMBNAIL_BUCKET });
      const [atFrom, atTo] = await Promise.all([store.exists(row.thumbnail_url), store.exists(thumbTo)]);
      if (atFrom && atTo) throw new Error(`“${row.name}” exists at both its old and its new place in ${store.name}; both were left`);
    }
  }
}

async function refileOneObject(client, projectId, p, row) {
  const ctx = { projectId, sceneId: p.scene.id, shotId: p.shot.id };
  const to = nestedShotKey(row.storage_path, ctx);
  const thumbTo = row.thumbnail_url ? nestedShotKey(row.thumbnail_url, ctx) : null;
  // Already nested (body and picture), or not this shot's key shape.
  if (!to && !thumbTo) return 'untouched';
  const local = row.storage_provider === FILE_PROVIDERS.LOCAL_SERVER;
  const where = { client, local, bucketName: BUCKET_FILES };
  let did = 'untouched';
  // 1. The body, then its row — at once. (A row whose body is nested already
  // and whose picture is not — a run that stopped between the two — skips
  // to the picture.)
  if (to) {
    await moveObjectVerified(where, row.storage_path, to, row.name);
    await rewriteFileRow(client, row, 'storage_path', row.storage_path, to,
      () => moveObjectVerified(where, to, row.storage_path, row.name));
    did = 'moved';
  }
  // 2. Its thumbnail, then its row — at once. The body is moved and its row
  // says so: whatever happens here, nothing above is put back.
  if (thumbTo) {
    const thumbWhere = { ...where, bucketName: THUMBNAIL_BUCKET };
    try {
      await moveObjectVerified(thumbWhere, row.thumbnail_url, thumbTo, row.name);
    } catch (err) {
      if (/is missing from/.test(err?.message || '')) {
        // A derived picture at neither key: the row stops naming it rather
        // than the shot being held back. (The file shows no picture from
        // then on — nothing regenerates a cloud thumbnail from its source
        // today, thumbnails.js — but the file itself is whole and moved.)
        await rewriteFileRow(client, row, 'thumbnail_url', row.thumbnail_url, null, async () => {});
        return 'moved';
      }
      throw err;
    }
    await rewriteFileRow(client, row, 'thumbnail_url', row.thumbnail_url, thumbTo,
      () => moveObjectVerified(thumbWhere, thumbTo, row.thumbnail_url, row.name));
    did = 'moved';
  }
  return did;
}

async function refileOneShot(client, projectId, project, p) {
  const sceneFolder = await ensureEntityFolderWith(client, projectId, project, 'scene', p.scene);
  if (!sceneFolder) throw new Error('the scene has no folder row');
  const toPath = `${sceneFolder.path}/${p.folder.slug}`;
  const legacyPrefix = `${shotObjectPrefix(projectId, null, p.shot.id)}/`;
  const rows = await filesUnderPrefix(client, projectId, legacyPrefix);
  await refileShotPreflight(client, projectId, p, rows, await listFoldersWith(client, projectId), toPath);
  let files = 0;
  for (const row of rows) {
    const did = await refileOneObject(client, projectId, p, row);
    if (did === 'moved') files += 1;
  }
  // Read again before the folder is re-parented: a row that landed under
  // the old prefix meanwhile keeps the folder where it is — this run can
  // be run again for it, and the offer stays until it is.
  const still = await filesUnderPrefix(client, projectId, legacyPrefix);
  if (still.length > 0) {
    throw new Error(`${still.length} file${still.length === 1 ? ' is' : 's are'} still under the old prefix after the move (“${still[0].name}”); run it again`);
  }
  const up = await client.from('folders')
    .update({ parent_id: sceneFolder.id, path: toPath })
    .eq('id', p.folder.id).select('id').maybeSingle();
  if (up.error) throw new Error(`the folder row could not be moved: ${up.error.message}`);
  if (!up.data || !up.data.id) throw new Error('the folder row could not be moved: the update reached no row');
  return { files, toPath };
}

// ── Shot lists, items and edits (0084) — module-level helpers ────────────
//
// Shared by loadProject and the list methods so the two can never disagree
// on rows or order (the listFoldersWith precedent). The S3a contract's order,
// identical on every backend: lists and edits by created_at then id, items by
// position then id. `.order('id')` is the TIE-BREAK, as it is for milestones
// (R2): without it two rows with the same key come back in heap order while
// the Local Server's stable sort does not.

// unwrapOptionalTable, with the S3a contract's err.code kept on a refusal
// (unwrapOptionalTable itself raises a new Error and drops it). Same
// tolerance, same bookkeeping — it IS unwrapOptionalTable underneath.
function unwrapOptionalShotListTable(result) {
  try {
    return unwrapOptionalTable(result);
  } catch (err) {
    if (result?.error?.code) err.code = result.error.code;
    throw err;
  }
}

// loadProject's read of shot_lists — AND the 0084 probe (see shotListsAbsent).
// Tolerates exactly what unwrapOptionalTable tolerates (42P01 / PGRST205) and
// records it; any other error still throws, because a refused read must not
// look like "this database has no shot lists".
function probeShotLists(result) {
  const code = result?.error?.code;
  if (code === '42P01' || code === 'PGRST205') {
    shotListsAbsent = true;
    return [];
  }
  const rows = unwrapOptionalShotListTable(result);
  shotListsAbsent = false;
  return rows;
}

function listShotListsWith(client, projectId) {
  return client.from('shot_lists').select('*').eq('project_id', projectId)
    .order('created_at').order('id').then(probeShotLists);
}

function listShotListItemsWith(client, projectId) {
  return client.from('shot_list_items').select('*').eq('project_id', projectId)
    .order('position').order('id').then(unwrapOptionalShotListTable);
}

function listEditsWith(client, projectId) {
  return client.from('edits').select('*').eq('project_id', projectId)
    .order('created_at').order('id').then(unwrapOptionalShotListTable);
}

const SHOT_LISTS_UNAVAILABLE_MSG =
  'Shot lists are not on this database yet (migration 0084).';

function shotListsUnavailable() {
  const err = new Error(`[supabase] ${SHOT_LISTS_UNAVAILABLE_MSG}`);
  err.code = 'shot_lists_unavailable';
  return err;
}

// Refuse before any request once a load has seen 0084 missing — the request
// could only fail, and its failure would be a schema-cache sentence.
function requireShotLists() {
  if (shotListsAbsent) throw shotListsUnavailable();
}

function requireProjectIdOn(row, noun) {
  if (row && typeof row === 'object' && row.project_id) return;
  const err = new Error(`[supabase] ${noun} needs its project_id`);
  err.code = 'invalid';
  throw err;
}

// A missing 0084 TABLE, on a write. PGRST205 is PostgREST's answer about the
// table the request named, so it needs no narrowing. A 42P01 can also come
// from INSIDE the statement (a trigger's query), so it counts only when the
// message names one of the three tables — the narrowing R2 asked of
// listTrashedMilestones' 42883.
function missing0084Table(error) {
  if (error?.code === 'PGRST205') return true;
  return error?.code === '42P01'
    && /\b(shot_lists|shot_list_items|edits)\b/.test(error.message || '');
}

// A missing 0084 FUNCTION: PGRST202 (PostgREST's schema cache), or a 42883
// that names THIS function. A 42883 raised inside its body (a helper dropped
// or re-signatured) is a real failure and must reach the caller.
// 🚨 PGRST202 is also PostgREST's answer to a parameter-NAME mismatch, which
// is why supabaseLoadProject.test.js pins every p_* name each method sends.
function missing0084Function(fnName) {
  return (error) => error?.code === 'PGRST202'
    || (error?.code === '42883' && (error.message || '').includes(fnName));
}

// S3a review round 2 (R2-3, parity2#2): the unique indexes behind the
// contract's collision rules answer 23505 with Postgres' own sentence —
// `duplicate key value violates unique constraint "edits_one_child_key"` —
// where the Local Server and the fixtures answer the contract's words. The
// provider pre-checks the chain and "Title · vN" against its own view, but
// edits and items are not broadcast, so in exactly the collaborative case
// these rules exist for its view is stale and the database is the one that
// refuses. These six become the contract's sentences; err.code stays 23505.
// Any other 23505 (a primary key, say) keeps the raw text. The two title
// sentences are generic: the database's message carries the key, not the
// title as typed.
const SHOT_LIST_UNIQUE_SENTENCES = new Map([
  ['edits_one_root_per_list_key', 'this shot list\'s edits form one chain — a new edit continues from the latest one'],
  ['edits_one_child_key', 'an edit\'s parent must be the latest edit of its shot list'],
  ['shot_lists_project_title_version_key', 'There is already a shot list with this title and version.'],
  ['edits_list_title_version_key', 'This shot list already has an edit with this title and version.'],
  ['shot_list_items_list_scene_key', 'a shot list holds each scene and each shot once'],
  ['shot_list_items_list_shot_key', 'a shot list holds each scene and each shot once'],
]);

// The contract sentence for a 23505 on one of the six, else null. Matched on
// the quoted constraint name exactly, so a longer name that merely starts the
// same way is not mistaken for one of them.
function shotListUniqueSentence(error) {
  if (error?.code !== '23505') return null;
  const m = /unique constraint "([^"]+)"/.exec(error.message || '');
  return (m && SHOT_LIST_UNIQUE_SENTENCES.get(m[1])) || null;
}

// The unwrap for every 0084 write and RPC. Three differences from unwrap(),
// all deliberate:
//   * the thrown Error keeps the Postgres / PostgREST code on err.code —
//     42501 (a guard trigger, a seat check or a policy), P0001 (a plain
//     RAISE, e.g. "the active shot list cannot be archived"), P0002 (not
//     found), 23505 (a unique index). unwrap() drops it, and the provider
//     needs it to tell a refusal from a fault without parsing the sentence.
//   * a 23505 on one of the six collision indexes is worded as the contract
//     words it (shotListUniqueSentence, R2-3).
//   * a missing table or function becomes shot_lists_unavailable AND records
//     0084 as absent, so the task / asset writes that follow stop sending the
//     columns it would have added.
// The bookkeeping is unwrap()'s, in the literal forms the source pin in
// supabaseLoadProject.test.js looks for.
function unwrapShotList({ data, error }, isMissing) {
  if (error) {
    const msg = shotListUniqueSentence(error) || error.message || String(error);
    if (isMissing(error)) {
      // The database answered, so the adapter is healthy; the feature is what
      // is missing. status() must not report a sync fault for it (the
      // listTrashedMilestones missing-function arm does the same).
      shotListsAbsent = true;
      lastError  = null;
      lastSyncAt = new Date();
      throw shotListsUnavailable();
    }
    lastError = msg;
    const err = new Error(`[supabase] ${lastError}`);
    if (error.code) err.code = error.code;
    throw err;
  }
  lastError  = null;
  lastSyncAt = new Date();
  return data;
}

// What an upsert of a list or an edit never sends (S3a review R1, addendum
// F; the reasons are in the note above SHOT_LIST_COLUMNS): the four columns
// fn_audit_touch stamps, and the two only the archive RPCs may change.
const SHOT_LIST_SERVER_OWNED = [
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'archived_at', 'archived_by',
];

// p_items for the replace and the upsert: exactly the four keys the functions
// read, every one present (null when absent — their COALESCE gives a missing
// position the item's index). A value that is not an array goes to the
// database as-is (null when absent), so the call still names EVERY
// parameter: omitting p_items would make PostgREST look for a function
// without it and answer PGRST202 — which would be misread as "0084 is
// missing" instead of "items must be a JSON array".
function shotListItemsParam(items) {
  return Array.isArray(items)
    ? items.map(it => ({
      id:       it?.id ?? null,
      scene_id: it?.scene_id ?? null,
      shot_id:  it?.shot_id ?? null,
      position: it?.position ?? null,
    }))
    : (items ?? null);
}

// A refusal the adapter words itself, shaped like unwrapShotList's: the
// `[supabase] ` prefix and a Postgres-style code on err.code.
function shotListRefusal(message, code) {
  const err = new Error(`[supabase] ${message}`);
  err.code = code;
  return err;
}

// The Local Server's words for a reorder it refuses (electron/rabbitShotLists.cjs
// MSG), so the provider shows one sentence whichever backend refused.
const REPOSITION_NEEDS_ID = 'each item of a reorder needs an id';
const ITEM_POSITION = 'an item\'s position must be a whole number of at least 0';
const ITEM_ID_TWICE = 'an item id appears more than once';

// p_items for the REORDER (S3a review round 2, R2-2): validated, then cut to
// the two keys the positions-only arm of upsert_shot_list_items reads.
// Validated HERE, before any request, because that arm is silent where the
// other backends refuse: it skips an item without an id, gives a missing
// position the item's index (a reorder that forgot a position would move a
// row to wherever it sits in the payload), and an id named twice updates its
// row from either entry, unpredictably (UPDATE … FROM with two matches). In
// payload order, as the Local Server checks: the array, then per item its id,
// its position, a repeat. Code `invalid`, the adapter's own pre-request code.
function repositionItemsParam(items) {
  if (!Array.isArray(items)) throw shotListRefusal('items must be a JSON array', 'invalid');
  const seen = new Set();
  return items.map((it) => {
    const id = it && typeof it === 'object' && !Array.isArray(it) ? it.id : null;
    if (id == null || id === '') throw shotListRefusal(REPOSITION_NEEDS_ID, 'invalid');
    if (!Number.isInteger(it.position) || it.position < 0) throw shotListRefusal(ITEM_POSITION, 'invalid');
    if (seen.has(String(id))) throw shotListRefusal(ITEM_ID_TWICE, 'invalid');
    seen.add(String(id));
    return { id, position: it.position };
  });
}

// 🚨 RLS does not REFUSE a DELETE, it FILTERS it. shot_list_items_delete's
// USING clause (0084 §8: can_edit_shot_lists) hides the rows of a list the
// caller may not change, and the statement deletes nothing and reports
// success — a quiet { deleted: [] } that the provider took for "removed"
// while nothing was (r2 closure#10). So when a delete removed fewer rows than
// it named, this asks why, cheapest question first:
//   1. Which of the named ids are STILL rows of this list? The DELETE named
//      exactly those, so a row it left behind is a row it could not see: the
//      caller lacks write rights → 42501 "you cannot change this shot list".
//      Filtered by the list too, or an id the DELETE rightly skipped because
//      it belongs to ANOTHER list would read as a refusal.
//   2. None left, and something was deleted: the list exists, and the rest
//      were not (or no longer) in it — ignored, as the contract says.
//   3. None left and nothing deleted: does the list exist? Gone (or not
//      visible) → "shot list not found" (P0002, the RPCs' answer).
// Review round 2 reverted the archived-list freeze (R2-1): an archived list's
// items are deleted like any other's, so archived_at is no longer read.
// Best effort: if a read itself fails the DELETE still happened, and the rows
// it removed are the true answer.
async function explainItemDeleteShortfall(client, listId, ids, deleted) {
  const gone = new Set(deleted);
  const left = await client.from('shot_list_items').select('id')
    .eq('shot_list_id', listId).in('id', ids.filter(id => !gone.has(id)));
  if (left.error) return;
  if ((left.data || []).length > 0) throw shotListRefusal('you cannot change this shot list', '42501');
  if (deleted.length > 0) return;
  const list = await client.from('shot_lists').select('id').eq('id', listId);
  if (list.error) return;
  if (!(list.data || [])[0]) throw shotListRefusal('shot list not found', 'P0002');
}

// ── Bins on the cloud (0091, BC1) — module-level helpers ──────────────────
//
// The same contract electron/rabbitBins.cjs gives the signed-out desktop,
// over the four cloud tables and the eleven SECURITY INVOKER RPCs. What the
// cloud cannot do on its own — pick files with an OS dialog, read a file's
// columns, stream its bytes, relink a drive, open a file — answers
// `not_supported_here` through ONE capability object (CLOUD_BINS_CAPABILITIES)
// the provider reads; BC2's desktop-signed-in mode fills those from the Local
// Server's routes when the computer can reach the file.
//
// A database WITHOUT 0091 (a client ahead of its database): loadProject's
// read of public.bins is the probe (0084's shotListsAbsent shape, no extra
// request) — a 42P01 / PGRST205 there marks the four tables absent, every
// bins READ answers [] and every bins WRITE refuses before any request with
// code `bins_unavailable`. 0091 adds no column to any table the client
// upserts, so there is nothing for stripUnmigrated to strip. Not cleared by
// resetSupabaseAdapter (auth events do not change the schema); cleared by the
// next load that finds the table, and by resetBinsSchemaState() for tests.

export const CLOUD_BINS_CAPABILITIES = Object.freeze({
  backend: 'supabase',
  // the OS dialogs (pickBinFiles / pickBinFolder) and the walk of a picked
  // folder (prepareBinFiles): the desktop's alone
  pickFiles: false,
  // probeBinFile reads a file's technical columns: needs the file
  probe: false,
  // binFileStreamUrl plays or scrubs bytes: needs the file
  stream: false,
  // the backend says whether each file is reachable (`online` on the rows);
  // false means the provider marks every row "not on this computer"
  resolveFiles: false,
  // binRelinkScan / binRelinkApply, removeBinRoot: the desktop's known roots
  relink: false,
  // openBinFile (the OS default app / Explorer)
  openInOs: false,
  // where a clip's picture lives: 'cloud' = rabbit-thumbnails, signed per
  // read (binFilePosterUrl); 'local' = the desktop's cache (binFileThumbnailUrl)
  posters: 'cloud',
  // bin_locations exist (a cloud clip is a location + a relative path)
  locations: true,
  // the admin's switch (B5a) can be read and, by an admin, set
  remoteViewingSwitch: true,
});

let binsAbsent = false;

// For tests only: forget what the last load learned about 0091.
export function resetBinsSchemaState() {
  binsAbsent = false;
}

const BINS_UNAVAILABLE_MSG = 'Bins are not on this database yet (migration 0091).';
function binsUnavailable() {
  const err = new Error(`[supabase] ${BINS_UNAVAILABLE_MSG}`);
  err.code = 'bins_unavailable';
  return err;
}
function requireBins() {
  if (binsAbsent) throw binsUnavailable();
}

// loadProject's read of bins — AND the 0091 probe.
function probeBins(result) {
  const code = result?.error?.code;
  if (code === '42P01' || code === 'PGRST205') {
    binsAbsent = true;
    return [];
  }
  const rows = unwrapOptionalShotListTable(result);
  binsAbsent = false;
  return rows;
}

// The orders every backend returns (the Local Server sorts its arrays the
// same way, binsOrder.js): bins and files by sort_order then id; takes by
// shot, position, then id; locations by name then id.
function listBinsWith(client, projectId) {
  // Every list is PAGED (BC3 review round 2): PostgREST answers at most
  // max_rows (1,000, supabase/config.toml) and says nothing about the rest,
  // so an unpaged read showed a browser's catalogue — "every bin and clip" —
  // cut at the thousandth clip of a larger project. Each order is total
  // (its last key is the id), so no row straddles two pages.
  return readAllPagesWith(() => client.from('bins').select('*').eq('project_id', projectId)
    .order('sort_order').order('id'), probeBins);
}
function listBinFilesWith(client, projectId) {
  return readAllPagesWith(() => client.from('bin_files').select('*').eq('project_id', projectId)
    .order('sort_order').order('id'), unwrapOptionalShotListTable);
}
function listShotTakesWith(client, projectId) {
  return readAllPagesWith(() => client.from('shot_takes').select('*').eq('project_id', projectId)
    .order('shot_id').order('position').order('id'), unwrapOptionalShotListTable);
}
// The caller's workspace's locations: RLS scopes the read to it, so no
// workspace id is needed (and none is trusted from a caller).
function listBinLocationsWith(client) {
  return readAllPagesWith(() => client.from('bin_locations').select('*')
    .order('name').order('id'), unwrapOptionalShotListTable);
}

function missing0091Table(error) {
  if (error?.code === 'PGRST205') return true;
  return error?.code === '42P01'
    && /\b(bins|bin_files|bin_locations|shot_takes)\b/.test(error.message || '');
}
function missing0091Function(fnName) {
  return (error) => error?.code === 'PGRST202'
    || (error?.code === '42883' && (error.message || '').includes(fnName));
}

// The sentences a person reads when the database refuses (the refusal map).
// Matched on the constraint or policy Postgres names, never on the whole
// text; anything else keeps Postgres' own words. err.code keeps the SQLSTATE.
export const BINS_REFUSALS = Object.freeze({
  gate: 'you cannot change this project\'s bins',
  takesGate: 'you cannot change this project\'s takes',
  locationsGate: 'you cannot change this company\'s footage locations',
  locationShape: 'A footage location is written as its network address, like \\\\server\\footage — never a drive letter, never this computer (localhost), never an administrative share like C$, never with .. in it, and without a trailing backslash.',
  locationExists: 'This location is already in the company\'s list.',
  locationInUse: 'This location still has clips in it — move or remove them before taking it away.',
  locationName: 'A footage location needs a name.',
  relativePath: 'A clip\'s path inside its location must be relative: forward slashes, no leading slash, no .., no drive letter.',
  posterPath: 'A clip\'s picture must sit under its own project in the thumbnails bucket.',
  binName: 'A bin needs a name.',
  clipName: 'A clip needs a name.',
  binCycle: 'a bin cannot be inside itself',
  takeTwice: 'this take is already assigned to that shot',
  takeProject: 'a take must name a shot and a clip of the same project',
  remoteViewingOff: 'This company has not allowed files to be viewed from outside the office network, so WILSON keeps no picture of this clip in the cloud. A workspace admin can turn that on in the company settings.',
  switchAdminOnly: 'Only a workspace admin can change whether files may be viewed from outside the office network.',
  notSupportedHere: 'is not supported here — it needs the desktop app on a computer that can reach the footage.',
});

const BINS_CONSTRAINT_SENTENCES = new Map([
  ['bin_locations_unc_path_shape_chk', BINS_REFUSALS.locationShape],
  ['bin_locations_workspace_unc_key', BINS_REFUSALS.locationExists],
  ['bin_locations_name_not_blank_chk', BINS_REFUSALS.locationName],
  ['bin_files_location_fk', BINS_REFUSALS.locationInUse],
  ['bin_files_relative_path_shape_chk', BINS_REFUSALS.relativePath],
  ['bin_files_poster_path_shape_chk', BINS_REFUSALS.posterPath],
  ['bin_files_display_name_not_blank_chk', BINS_REFUSALS.clipName],
  ['bins_name_not_blank_chk', BINS_REFUSALS.binName],
  ['shot_takes_shot_file_key', BINS_REFUSALS.takeTwice],
  ['shot_takes_shot_fk', BINS_REFUSALS.takeProject],
  ['shot_takes_file_fk', BINS_REFUSALS.takeProject],
]);

// The sentence for a refusal the database worded as a constraint, a policy
// or one of 0091's own RAISEs, else null.
export function binsRefusalSentence(error) {
  if (!error) return null;
  const msg = error.message || '';
  const named = /(?:constraint|policy) "([^"]+)"/.exec(msg);
  if (named && BINS_CONSTRAINT_SENTENCES.has(named[1])) return BINS_CONSTRAINT_SENTENCES.get(named[1]);
  if (/petal_bin_posters_remote_viewing/.test(msg)) return BINS_REFUSALS.remoteViewingOff;
  if (error.code === '42501' && /row-level security policy for table "(bins|bin_files)"/.test(msg)) return BINS_REFUSALS.gate;
  if (error.code === '42501' && /row-level security policy for table "shot_takes"/.test(msg)) return BINS_REFUSALS.takesGate;
  if (error.code === '42501' && /row-level security policy for table "bin_locations"/.test(msg)) return BINS_REFUSALS.locationsGate;
  return null;
}

// The unwrap for every 0091 write and RPC: keeps the SQLSTATE on err.code,
// words a named refusal as the map words it, and marks 0091 absent on a
// missing table or function (unwrapShotList's three differences, kept).
function unwrapBins({ data, error }, isMissing) {
  if (error) {
    if (isMissing(error)) {
      binsAbsent = true;
      lastError  = null;
      lastSyncAt = new Date();
      throw binsUnavailable();
    }
    const msg = binsRefusalSentence(error) || error.message || String(error);
    lastError = msg;
    const err = new Error(`[supabase] ${lastError}`);
    if (error.code) err.code = error.code;
    throw err;
  }
  lastError  = null;
  lastSyncAt = new Date();
  return data;
}

// A refusal the adapter words itself (the shotListRefusal shape).
function binsRefusal(message, code) {
  const err = new Error(`[supabase] ${message}`);
  err.code = code;
  return err;
}
function notSupportedHere(what) {
  const err = new Error(`[supabase] ${what} ${BINS_REFUSALS.notSupportedHere}`);
  err.code = 'not_supported_here';
  err.status = 501;
  return err;
}

// What an upsert of a bin never sends: the four audit columns fn_audit_touch
// stamps (S3a's addendum F, the same reasons).
const BIN_SERVER_OWNED = ['created_at', 'created_by', 'updated_at', 'updated_by'];
// What a bin_files patch never sends: identity, who added it and when, the
// stamps, and `online` (not a column — a fact about the reading computer).
const BIN_FILE_PATCH_DROP = ['id', 'project_id', 'workspace_id', 'added_by', 'added_at', 'updated_at', 'online'];
const BIN_KINDS_0091 = ['footage', 'audio', 'stills', 'graphics', 'vfx', 'selects', 'other'];
const POSTER_BUCKET = 'rabbit-thumbnails';
const POSTER_MAX_BYTES = 262144; // the bucket's own cap (0053)

// A renderer-decoded JPEG, as a Uint8Array; the same narrowing the Local
// Server's thumbnail route makes (magic number, size cap).
function posterBytesFrom(base64) {
  if (!base64 || typeof base64 !== 'string') throw binsRefusal('base64 required', 'invalid');
  let bin;
  try { bin = atob(base64); } catch { throw binsRefusal('unreadable body', 'invalid'); }
  if (!bin.length) throw binsRefusal('unreadable body', 'invalid');
  if (bin.length > POSTER_MAX_BYTES) throw binsRefusal('thumbnail too large', 'invalid');
  if (!(bin.charCodeAt(0) === 0xff && bin.charCodeAt(1) === 0xd8 && bin.charCodeAt(2) === 0xff)) {
    throw binsRefusal('not a JPEG', 'invalid');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Columns a per-field patch must never carry: identity/tenancy, audit
// stamps, and the trash columns (RPC-only under the 0014 policies — a
// plain UPDATE with deleted_at either 42501s or silently no-ops).
const PATCH_DROP = [
  'id', 'workspace_id', 'created_at', 'created_by',
  'updated_at', 'updated_by', 'last_updated_at', 'last_updated_by',
  'deleted_at', 'deleted_by',
  // 0090 (S5b): written ONLY by set_aside_schedule_rows (setAsideRows). A
  // stale copy re-sent from another window must never bring a row back.
  'set_aside_at',
];

// 0090 (S5b): the set-aside stamp never rides an ordinary task, phase or key
// date upsert either — phases have no allowlist, so without this a whole
// phase row re-sent with its old stamp would write it.
const SET_ASIDE_WRITE_DROP = ['created_at', 'updated_at', 'set_aside_at'];

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

// 🚨 THE REFUSAL STAYS after C3 closed §6 #31. Attachments now have a real
// cloud home (public.files + the rabbit-files bucket, reached through
// uploadFile), and nothing in the app writes these arrays in cloud mode any
// more — which is exactly why a patch that still carries them is a caller
// that was missed, and dropping its files silently is the S15 defect this
// throw exists to prevent. Only the ADVICE changed: it names the surface that
// works instead of a promise about future work.
const ATTACHMENTS_MSG =
  'Cloud projects store files as file records, not on the project row — '
  + 'this attachment was not saved. Add it from the project’s Resources list '
  + '(or RABBIT’s Files view), which uploads to the rabbit-files bucket and '
  + 'writes a row in public.files.';

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
      // Demo 2026-09-11: is_private joins the list only where 0072 has
      // landed — naming a column the database lacks fails the WHOLE list.
      const privateCol = (await privateProjectsAvailable(client)) ? ', is_private' : '';
      return unwrap(await client
        .from('projects')
        .select('id, title, status, status_tag, updated_at, budget_total, budget_currency, client_name, cover_image_url' + privateCol)
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
      //
      // A2 session 2: `milestones` joins for the fourth time for the same
      // reason — and this key is the one with a proven cost. S17 found that
      // localServerAdapter omitted it (§6 #47) and every milestone was reset
      // to [] on each load, project switch and realtime refetch: real data
      // loss, found by reading rather than by a test. Ordered by date, which
      // is how the timeline draws them and what makes both adapters agree.
      //
      // Post-overhaul S3a: shotLists / shotListItems / edits join for the
      // fifth time for the same reason (0084, D1–D22). They use the
      // 42P01/PGRST205-tolerant reads with NO blanket catch, and the
      // shot_lists read doubles as the 0084 probe — see shotListsAbsent.
      // Bins on the cloud (BC1, 0091): bins / binFiles / shotTakes /
      // binLocations join for the sixth time for the same reason — and
      // `binRoots` is answered [] (the signed-out desktop's known roots have
      // no cloud shape; a cloud clip is a location + a relative path). The
      // bins read doubles as the 0091 probe — see binsAbsent.
      const [project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns, budgetVersions, expenses, projectMembers, scenes, shots, levels, experiences, folders, milestones, shotLists, shotListItems, edits, bins, binFiles, shotTakes, binLocations] =
        await Promise.all([
          client.from('projects').select('*').eq('id', projectId).single().then(unwrap),
          client.from('phases').select('*').eq('project_id', projectId).order('sort_order').then(unwrap),
          client.from('assets').select('*').eq('project_id', projectId).order('sort_order').then(unwrap),
          client.from('tasks').select('*').eq('project_id', projectId).then(unwrap),
          listDependenciesWith(client, projectId),
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
          // Paged (S4c review round 2, item 8): the re-filing's offer counts
          // the bundle's shots and scenes, so a feature-sized project must
          // not be cut at PostgREST's 1,000 rows. `sort_order, id` is a
          // total order, so no row straddles two pages.
          readAllPages(() => client.from('scenes').select('*').eq('project_id', projectId)
            .order('sort_order').order('id')),
          readAllPages(() => client.from('shots').select('*').eq('project_id', projectId)
            .order('sort_order').order('id')),
          client.from('levels').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('experiences').select('*').eq('project_id', projectId)
            .order('sort_order').then(unwrapOptionalTable),
          client.from('folders').select('*').eq('project_id', projectId)
            .order('path').then(unwrapOptionalTable),
          // `.order('id')` is the TIE-BREAK, not decoration: `ORDER BY date`
          // alone leaves two key dates on the same day in an arbitrary heap
          // order, while the local adapter's Array.sort is stable — so the two
          // backends could return the same project in different orders, which
          // is what ordering this at all was meant to prevent (R2).
          client.from('milestones').select('*').eq('project_id', projectId)
            .order('date').order('id').then(unwrapOptionalTable),
          listShotListsWith(client, projectId),
          listShotListItemsWith(client, projectId),
          listEditsWith(client, projectId),
          listBinsWith(client, projectId),
          listBinFilesWith(client, projectId),
          listShotTakesWith(client, projectId),
          listBinLocationsWith(client),
        ]);
      // Post-overhaul S5b (0090): the rows the open bid version does not hold
      // are SET ASIDE. No SELECT policy hides them (they must stay readable to
      // be brought back), so they are split out HERE, into the four
      // setAside* keys, and every reader of tasks / phases / milestones /
      // dependencies sees the live schedule only. The same split runs in the
      // Local Server's, the fixtures' and Drive's loaders.
      return splitSetAside({
        project, phases, assets, tasks, dependencies, taskLinks, files,
        assetVersions, comments, ingestionRuns, budgetVersions, expenses,
        scenes, shots, levels, experiences, folders, milestones,
        shotLists, shotListItems, edits,
        bins, binFiles, binRoots: [], shotTakes, binLocations,
        teamAssignments: (projectMembers || []).map(m => ({
          project_id: m.project_id,
          member_id: m.user_id,
          project_role: m.project_role,
          project_title: m.project_title || '',
        })),
      });
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
      // Demo 2026-09-11: the private flag rides only where 0072 has landed;
      // elsewhere it is dropped so a create never fails on an unknown column
      // (ProjectsPage hides the checkbox in that case — this is the backstop).
      if (row.is_private !== undefined && !(await privateProjectsAvailable(client))) delete row.is_private;
      // Session 15: createProject used to discard droppedAttachments entirely,
      // so D.O.G.'s create-with-attachments modal lost every file WITHOUT any
      // error at all in cloud mode. A create carrying real attachments now
      // refuses; an empty-array create (ProjectsPage always sends
      // documents: [], visualAssets: []) is not an attachment and passes.
      if (droppedAttachments && hasRealAttachments(payload)) {
        throw new Error(ATTACHMENTS_MSG);
      }
      // 0089 (S5): a new project has no bid versions, so none is open; a
      // payload copied from another project's row would name ITS version,
      // which the same-project FK refuses (and a database without 0089 has
      // no such column at all).
      delete row.open_budget_version_id;
      // 0084: the one project write that never runs toColumns, so the
      // older-database strip is applied here by hand (see stripUnmigrated).
      const data = unwrap(await client.from('projects')
        .insert(stripUnmigrated('projects', row)).select().single());
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
      const row = sanitize(phase, SET_ASIDE_WRITE_DROP);
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
      const row = toColumns('tasks', sanitize(task, SET_ASIDE_WRITE_DROP));
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
    //
    // Two tables, one client-side collection (ctx.dependencies). `kind` picks
    // the table on the way in and is re-stamped on the row that comes back.
    //
    // 🚨 Re-stamping is not cosmetic. DetailPane.visibleDeps routes the ARROW
    // by `d.kind || 'task'`, while buildSchedule and selectCriticalPath route
    // by endpoint membership in taskById. The two layers classify by different
    // fields, so a phase row returned WITHOUT `kind` is looked up in
    // rowIndexByTaskId, misses, and its arrow silently vanishes while the
    // schedule stays correct — data present, picture wrong.
    async upsertDependency(dep) {
      const client = await requireClient();
      const kind   = dependencyKind(dep);
      const table  = DEPENDENCY_TABLE[kind];
      const saved  = unwrap(
        await client.from(table).upsert(toColumns(table, dep)).select().single()
      );
      return { ...saved, kind };
    },

    // Argument two is projectId and argument three is kind — that order is
    // forced, not chosen. localServerAdapter.deleteDependency(id, projectId)
    // LOAD-BEARS on argument two for its URL, so kind has to go after it.
    //
    // When the caller cannot say which kind it is — a history entry from
    // before this session, or a row loaded before 0061 — both tables are
    // tried. The delete is keyed on a uuid primary key, so the miss is a
    // zero-row no-op rather than a wrong delete.
    async deleteDependency(id, _projectId, kind) {
      const client = await requireClient();
      const tables =
        kind === 'phase' ? ['phase_dependencies'] :
        kind === 'task'  ? ['task_dependencies']  :
                           ['task_dependencies', 'phase_dependencies'];
      for (const table of tables) {
        // unwrapOptionalTable, not unwrap: this file's own header records that
        // the beta auto-deploys on every push while migrations are applied by
        // hand, so there is a real window where this client knows about
        // phase_dependencies and the database does not. A bare unwrap() would
        // make every dependency delete fail during that window, including the
        // task edges that have nothing to do with 0061.
        unwrapOptionalTable(await client.from(table).delete().eq('id', id));
      }
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
    // 🚨 SESSION 42 — `opts` IS A FOURTH PARAMETER AND NOT A KEY ON `scope`.
    // `scope` is the row's shape: uploadContainerFor reads it, and its keys land
    // in the `files` INSERT through the column allowlist. A callback smuggled in
    // there would either be stripped silently or reach toColumns as a value, and
    // the S23/S28 lesson is that the allowlist and the call site are different
    // things. Progress is transport, not content, so it travels beside the scope.
    async uploadFile(projectId, scope = {}, file, opts = {}) {
      const client = await requireClient();
      // Session 24: `INVOICES` is a RESERVED path segment, and the check
      // comes first so a financial file can never be filed under another
      // entity. 🚨 THE POLICY FAMILY IS `rabbit_files_money_*`, NOT
      // `rabbit_files_invoices_*`: 0042 dropped the invoices name, and there
      // are FOUR base rabbit-files policies, not three — eight in total, which
      // is what 0042's own post-condition asserts. The phantom name is the S39
      // incident recorded in OUTSTANDING.md, found here for the third time.
      // The money policies key on exactly this third segment, and the four
      // base policies exclude it — so the segment IS the gate for the blob,
      // while files.is_financial gates the row. Changing either without the
      // other opens a hole.
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
      //
      // ── Post-overhaul S4b (migration 0088): `scope.legal` ────────────────
      // Audrey, 2026-10-01: a Legal file is seen by "same as money files"
      // (workspace admins and the project's managers), and Legal is chosen
      // when the file is ADDED — "its just the folder that is locked". So a
      // Legal upload is the invoice shape with its own locked folder: the
      // LEGAL third segment (the blob gate, through rabbit_money_segment), the
      // legal tag written with it (the row gate reads the folder; the CHECK
      // ties the two), and the Supabase pin in the same three branches that
      // pin money. Both refusals below come BEFORE any byte moves: a database
      // without 0088 would file it in an ordinary folder every member can
      // read, and someone outside the gate would be refused by the storage
      // policy only after the transfer.
      // S4d (0092, Audrey 2026-10-08): the gate asked is the LEGAL gate —
      // can_access_project_legal, the money audience plus workspace managers
      // — never the money gate (legalUpload.test.js pins which RPC is named;
      // files_legal_not_financial_chk refuses a Legal row that is also an
      // invoice in the database, as the first refusal here does).
      const legal = !!scope.legal;
      if (legal && scope.financial) {
        throw new Error('A file is added as Legal or as an invoice or receipt, not both.');
      }
      // Never core either (files_legal_not_core_chk) — refused here, before
      // the bytes move, not by the INSERT after them (review round 1, R1-BEH-07).
      if (legal && scope.isCoreDefiner) throw new Error(LEGAL_NOT_CORE_REASON);
      if (legal) {
        if (!(await legalFilesAvailable(client))) throw new Error(LEGAL_UNAVAILABLE);
        if (!(await canAccessProjectLegal(client, projectId))) throw new Error(LEGAL_GATE_REFUSAL);
      }
      // Money-gated: under a locked folder, and never out of Supabase.
      const moneyGated = !!scope.financial || legal;
      const container = uploadContainerFor(scope, projectId);

      // The folder row this file belongs to (0043). The caller may pass one —
      // the folder view knows exactly where it dropped the file — otherwise
      // resolve it from the container entity, which is the same lookup
      // ensureEntityFolder does. Best-effort on purpose: a missing folder row
      // must not refuse an upload. The file is still fully addressable by its
      // storage_path and its entity link, and the next ensureEntityFolder
      // reconciles the tree.
      // A Legal file is not filed in an entity's folder, passed or looked up:
      // the explorer shows it in the LEGAL folder (fileTree.js), whatever it
      // is about.
      let folderRow = null;
      if (container.key && !legal) {
        try {
          const { data } = await client
            .from('folders').select('id, path')
            .eq('project_id', projectId)
            .eq(container.key, container.id)
            .maybeSingle();
          folderRow = data && data.id ? data : null;
        } catch { /* the tree is a convenience here, not a precondition */ }
      }
      const folderId = legal ? null : (scope.folderId || folderRow?.id || null);

      const entity   = legal ? LEGAL_SEGMENT : scope.financial ? 'INVOICES' : container.seg;
      const entityId = scope.financial ? (scope.lineId || projectId) : container.id;
      const safeName = (file?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
      let prefix = `projects/${projectId}/${entity}/${entityId}`;
      // S4c: a SHOT's objects sit inside its scene's prefix
      // (shotRefiling.shotObjectPrefix: projects/<pid>/scenes/<sceneId>/
      // <shotId>) — unless the shot's folder row still sits under SHOTS, a
      // project from before S4c that has not been re-filed, where the old
      // prefix keeps the objects and the folder together until the one-time
      // move takes both. The third segment is `scenes` either way for a
      // nested key, which no gate locks; never money-gated (an invoice is
      // never a shot's).
      if (!moneyGated && container.key === 'shot_id') {
        const underShots = typeof folderRow?.path === 'string' && folderRow.path.startsWith('SHOTS/');
        const sceneId = underShots ? null : await shotSceneId(client, container.id);
        prefix = shotObjectPrefix(projectId, sceneId, container.id);
      }
      const storagePath = `${prefix}/${Date.now()}-${safeName}`;

      // Session 36: which store holds this body. Decided ONCE, here, next to
      // the branch that already chose the INVOICES segment — so the row and
      // the path can never disagree about whether this file is money.
      //
      // 🚨 A FINANCIAL UPLOAD IS PINNED TO SUPABASE whatever the workspace
      // selected (§4a2b invariant 2): only RLS enforces the money gate, and
      // no Drive or S3 sharing model binds to a WILSON project role. Migration
      // 0050's files_money_provider_chk refuses the same rows in the database,
      // so a caller that bypasses this line is still refused. The pin lives
      // INSIDE fileProviderFor, before the workspace's choice is consulted.
      //
      // Session 37: the argument is the workspace's ACTIVE provider — S36's
      // constant became one argument, as its comment promised. The read is
      // cached (getWorkspaceStorageCached) and FAILS CLOSED: if the choice
      // cannot be determined, the upload is refused with a sentence rather
      // than guessed at — a guess of 'petal' would silently route media to a
      // store the customer may have explicitly moved away from.
      // ── Demo 2026-09-11: a PRIVATE project keeps its media on this computer ──
      // Audrey: "all databases need to live in the supabase storage at all
      // times … the only thing local storage should be related to is just
      // the media files and asset of the project." The row is a cloud row
      // like any other; the body goes to the desktop's own disk through the
      // local_server provider (storage/localServerProvider.js; routes in
      // electron/localMedia.cjs). Decided HERE, beside the money pin, and
      // the money pin still wins: an invoice on a private project stays in
      // Supabase (0050's files_money_provider_chk agrees). Off the desktop
      // the provider's put() refuses with a sentence — a private project's
      // media can only be added on the computer that holds it.
      // S4b: a Legal file is money-gated exactly here too (I4): never on the
      // private project's local disk, never refused on a NAS workspace, and
      // pinned to Supabase on an s3 one — files_money_provider_chk refuses
      // any other provider for a LEGAL key in the database as well.
      let storageProvider;
      if (!moneyGated && await projectIsPrivate(client, projectId)) {
        storageProvider = FILE_PROVIDERS.LOCAL_SERVER;
      } else {
        const storageChoice = await getWorkspaceStorageCached();
        const activeProvider = activeWorkspaceProvider(storageChoice);
        // The one workspace provider with no cloud-side implementation
        // (S36's review): 'network' bodies live on the customer's own
        // filesystem, which only the desktop's Local Server path can reach.
        // Refused with a sentence, never routed — and money-gated files are
        // exempt because their body never leaves Supabase anyway.
        if (activeProvider === WORKSPACE_PROVIDERS.NETWORK && !moneyGated) {
          throw new Error(
            'this workspace stores media on its own server or NAS — add files from ' +
            'the desktop app in Local Server mode; the cloud backend cannot write ' +
            'to a network drive',
          );
        }
        storageProvider = fileProviderFor(activeProvider, {
          financial: moneyGated,
        });
      }
      try {
        await getStorageProvider(storageProvider).put(storagePath, file, {
          contentType: file?.type,
          // Only the resumable transport reports progress; the standard PUT and
          // the s3 presigned PUT ignore this, which is why a small upload shows
          // no bar rather than a fake one.
          onProgress: opts.onProgress,
        });
      } catch (upErr) {
        lastError = upErr?.message || String(upErr);
        throw upErr;
      }

      // Session 39: the derived preview, generated HERE because the body is
      // already in memory. Generating later — on demand, or server-side —
      // means downloading the source first: gigabytes of egress for a postage
      // stamp, on exactly the multi-GB media this product is for (§4a2).
      //
      // 🚨 BEST-EFFORT, DELIBERATELY, and it is the same rule the folder-row
      // lookup above states: a missing convenience must not refuse an upload.
      // generateThumbnail() returns null rather than throwing; the put is the
      // only part that can raise, and it is caught here. The source body has
      // ALREADY LANDED at this point, so anything thrown from here would
      // strand it — a failed preview must cost a preview.
      //
      // 🚨 SESSION 44 — THE THUMBNAIL GOES WHERE THE BODY WENT. It is handed
      // `storageProvider`, the SAME variable the body was just written with,
      // four lines up. One decision, used twice: the derived preview cannot
      // land at a different store than its source, because there is no second
      // decision to disagree with.
      //
      // This REVERSES S39, deliberately (Audrey, 2026-08-08): "the image should
      // be kept in the company storage. if the thumbnail lived in the petal
      // cloud it would break tpn inherently". A still frame IS the content —
      // a legible 256px frame of pre-release footage held on Petal's
      // infrastructure makes Petal a content-bearing party, which is exactly
      // what a customer choosing their own bucket is paying to avoid. S39's
      // counter-arguments (10–30 KB, one code path, no presign per tile) are
      // operational conveniences and they lose to a compliance boundary.
      //
      // ⚠️ NO MONEY BRANCH HERE, AND THAT IS THE RULE WORKING. `storageProvider`
      // is already Supabase for a financial upload — fileProviderFor pins it
      // before the workspace's choice is read — so an invoice's preview stays
      // in rabbit-thumbnails by following its body, not by a special case. If
      // this line ever needs a money test, the pin has been moved out of the
      // one place that owns it.
      //
      // 🚨 SESSION 40 — VIDEO TAKES A DIFFERENT DECODER TO THE SAME
      // DESTINATION. The branch is on the SOURCE (which decoder can read these
      // bytes), never on the destination: both arms produce a 256px JPEG and
      // both hand it to the one `putThumbnailTo(storageProvider, …)` below, so
      // S44's "one decision, used twice" survives a second generator. A second
      // put site is how a video still would start ignoring the provider its
      // body went to — the exact defect 0054 exists to prevent.
      //
      // A `<video>` cannot decode ProRes/DNxHD/MXF, so those yield null here and
      // the row keeps a file-type icon. On the desktop, ffmpeg covers them
      // separately (electron/ffmpeg.cjs); a browser-only user gets §5f's inline
      // notice instead of a silent absence.
      let thumbnailPath = null;
      try {
        // 🚨 looksLikeVideoFile, NOT canThumbnailVideo(file.type). File.type is
        // the EMPTY STRING for .mov/.mkv/.avi/.wmv on any machine whose OS MIME
        // registry lacks them, so a type-only gate sent an H.264 .mov to
        // generateThumbnail, whose own gate also refused it — no decoder ran at
        // all and the preview was lost through the one-way door.
        const thumb = looksLikeVideoFile(file)
          ? await generateVideoThumbnailFromFile(file)
          : await generateThumbnail(file);
        if (thumb) {
          const key = thumbnailKeyFor(storagePath);
          await putThumbnailTo(storageProvider, key, thumb, { client });
          thumbnailPath = key;
        }
      } catch (thumbErr) {
        // Never fatal. Logged rather than swallowed — S30's rule: walk DOWN
        // the stack to the layer that eats the error, and this is that layer.
        console.warn('[supabase] thumbnail not generated:', thumbErr?.message || thumbErr);
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
        // 🚨 THE FIRST WRITER THIS COLUMN HAS EVER HAD. Declared on three
        // tables in 0000 (files:232, assets:164, asset_versions:246) and never
        // written by anything until now — a dead field in the same family as
        // storage_mode. It holds the object's PATH inside rabbit-thumbnails,
        // not a URL: the bucket is private, so display URLs are signed at read
        // time and expire. (0040's thumbnail_image says the same of itself:
        // "A path or URL to the thumbnail, never image bytes.")
        thumbnail_url:    thumbnailPath,
        kind:             scope.kind || 'source',
        // 🚨 §6 #31 trap (b), THE POLARITY, resolved here rather than in the
        // database. files.is_core_definer is NOT NULL DEFAULT false and stays
        // that way (0075 post-condition 7, suite 79 probe 17): it is RABBIT's
        // own flag — "this file defines the asset" — and moving its default to
        // suit D.O.G. would re-mean every file on every project. D.O.G.'s
        // legacy arrays default `isCore` TRUE, so a 1:1 map would flip every
        // previously-unmarked file from CORE to REF and change generation
        // output. The flag therefore travels EXPLICITLY: the caller says what
        // it is, and runAttachmentMigration carries `isCore !== false` across
        // when it moves a legacy row. Neither side infers it from a default.
        is_core_definer:  !!scope.isCoreDefiner,
        // 0075. `|| null` rather than leaving it undefined: an uploader that
        // says nothing about the kind writes NULL — which is the truth for
        // every image and video — instead of asserting one.
        document_kind:    scope.documentKind || null,
        description:      scope.description  || null,
        // 0038. Must agree with the `invoices` path segment above: the row
        // and the blob are gated independently, and either one alone is a way
        // in — the amount is useless to hide if the invoice stating it is
        // readable.
        is_financial:     !!scope.financial,
      };
      // S4b (0088): the legal tag goes in with the LEGAL folder, in the same
      // INSERT — files_legal_folder_chk refuses either without the other.
      // Never sent otherwise: a database without 0085 has no tags column.
      if (legal) row.tags = ['legal'];
      // Demo 2026-09-11: the file's own facts — its source's modified time
      // and, for audio/video, its duration (storage/mediaMetadata.js,
      // bounded and best-effort) — where 0081 has landed. Read from the
      // File we already hold, never by downloading anything back.
      if (await fileMetaAvailable(client)) {
        const facts = await describeSourceFile(file);
        row.duration_sec = facts.durationSec;
        row.source_modified_at = facts.sourceModifiedAt;
      }
      const ins = await client.from('files').insert(row).select().single();
      if (ins.error) {
        // The blob landed but the row didn't — remove our own object so a
        // refused insert can't strand an orphan (rabbit_files_delete_own
        // policy, 0027). Best-effort: the GC orphan scan is the backstop.
        try { await getStorageProvider(storageProvider).del(storagePath); } catch { /* GC catches it */ }
        // Session 39: and its thumbnail, by the same reasoning and for a
        // stronger reason. With no files row there is no thumbnail_url, so
        // trg_files_gc_enqueue will never see this object and the queue drain
        // cannot reach it — the compensating delete is its ONLY cleanup.
        // (The orphan scan is Supabase-side but walks rabbit-files/projects/*,
        // not this bucket; see the stated limit in §12.7b.)
        // Never silent: this is the thumbnail's ONLY cleanup path, so a failure
        // here is the difference between "removed" and "a legible frame of the
        // content is in the bucket forever with nothing pointing at it".
        //
        // 🚨 S44: removed from THE STORE IT REACHED, via the same
        // `storageProvider` the put used. Deleting from Petal's bucket a
        // thumbnail that went to a customer's would succeed at removing
        // nothing, and leave the frame in the customer's bucket unreferenced —
        // a stranded object in someone else's storage, which is the one place
        // WILSON can never sweep (§12.4: no orphan scan walks a customer
        // bucket, by design).
        try {
          await removeThumbnailFrom(storageProvider, thumbnailPath, { client });
        } catch (rmErr) {
          console.warn('[supabase] stranded thumbnail not removed:', rmErr?.message || rmErr);
        }
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

    // ── Session 42: download WITHOUT buffering the object into memory ───────
    //
    // 🚨 downloadFile ABOVE CANNOT CARRY WHAT S42 LET PEOPLE UPLOAD. It resolves
    // the whole body as a Blob, FileManager then does URL.createObjectURL on it,
    // and the entire object has to exist in the renderer before one byte
    // reaches disk. At the pre-0057 50 MiB cap that was free. At 50 GiB it is
    // not survivable in a browser or in Electron's renderer — so migration 0057
    // raised the WRITE ceiling a thousandfold and left the READ side able to
    // accept files it could never give back. Found by this session's pre-deploy
    // review; it is the one open finding that could lose a customer's data
    // rather than merely annoy them.
    //
    // A signed URL hands the transfer to the browser's own download manager:
    // no Blob, no ceiling, resumable by the browser, and it starts instantly.
    //
    // 🚨 STILL FULLY GATED. The URL is minted by the CALLER's authenticated
    // client, so storage-api evaluates the same RLS at signing time — a member
    // who cannot read an invoice cannot sign one either. The money gate (0042)
    // is untouched.
    //
    // ⚠️ SHORT EXPIRY ON PURPOSE. 300s, against fileUrl's 3600s, because a
    // download URL is a bearer capability over pre-release content and only has
    // to survive long enough to START. Expiry is checked when the request is
    // made, not while the response streams, so a 40 GiB transfer that begins
    // inside the window completes however long it takes.
    //
    // Returns null when the row's provider cannot mint a URL (s3 today — see
    // fileUrl's note), and the caller falls back to the Blob path. That is the
    // stated capability gap, not a fault.
    async downloadUrl(file, filename, expiresIn = 300) {
      const client = await requireClient();
      const provider = resolveFileProvider(file);
      if (typeof provider.getUrl !== 'function') return null;
      const url = await provider.getUrl(file.storage_path, expiresIn, {
        // Cross-origin `a.download` is ignored, so the attachment disposition
        // and the real filename both have to come from the signature.
        download: filename || file?.name || 'download',
      });
      if (!url) return null;
      // 🚨 THE AUDIT ROW MUST STILL BE WRITTEN. S33/0047 (TPN-CONT-008,
      // TPN-LOG-002) logs every download, and downloadFile does it above — a
      // second download path that skipped it would make the trail silently
      // incomplete for exactly the largest, most sensitive assets. Same
      // best-effort idiom, same explicit .error check, because rpc() resolves
      // for every status.
      try {
        const logged = await client.rpc('log_file_downloaded', { p_file_id: file.id });
        if (logged.error) console.warn('[supabase] download not logged:', logged.error.message);
      } catch (err) {
        console.warn('[supabase] download not logged:', err?.message || err);
      }
      return url;
    },

    // Session 40: a streamable URL for the video player (§5d.2).
    //
    // 🚨 THE PROVIDER THE ROW NAMES, exactly as downloadFile does — never the
    // workspace's current setting. A workspace that switched provider must
    // still be able to play what it wrote before the switch.
    //
    // Returns null when that provider has no `getUrl`. That is a STATED
    // capability gap, not a fault: `getUrl` is deliberately absent from the
    // registry's REQUIRED list (storage/index.js) because s3 cannot implement
    // it usefully yet — a presigned GET expires in 300s (storage-presign
    // EXPIRES), so a clip longer than five minutes would die mid-playback, and
    // there is no S3 workspace on any environment to verify a longer-lived
    // signer against. Same reasoning, and the same deferral, as S44's
    // thumbnail display.
    //
    // A signing ERROR still throws — an RLS refusal must not read as "this
    // format has no preview".
    async fileUrl(file, expiresIn = 3600) {
      await requireClient();
      const provider = resolveFileProvider(file);
      if (typeof provider.getUrl !== 'function') return null;
      return await provider.getUrl(file.storage_path, expiresIn);
    },

    // Session 39: display URLs for a batch of thumbnails.
    //
    // 🚨 BATCHED, not per tile. rabbit-thumbnails is PRIVATE (0053), so every
    // preview needs a signed URL and a file grid renders dozens at once —
    // per-tile signing is the difference between a grid that paints and one
    // that crawls.
    //
    // RLS is the authority on WHICH of them come back: a non-manager asking
    // for an invoice thumbnail gets no URL for that key and the UI falls back
    // to an icon. The caller never has to know which keys were money-gated,
    // which is what keeps the gate in one place.
    //
    // ⚠️ S44 — PETAL-HOSTED PREVIEWS ONLY, and FileManager filters to match.
    // Since S44 a thumbnail lives at its body's provider, so an s3 workspace's
    // previews are in the customer's bucket and cannot be signed from here.
    // Displaying those needs a batch presign that does not exist yet, and no
    // S3 workspace exists on any environment to verify one against — so it is
    // its own session (Audrey, 2026-08-08). Those rows are excluded upstream
    // rather than looked up and silently missed; their tiles show file-type
    // icons. See storage/thumbnails.js `signedThumbnailUrls` for why the WRITE
    // half shipped without the read half.
    async thumbnailUrls(paths, expiresIn = 3600) {
      const client = await requireClient();
      return signedThumbnailUrls(client, paths, expiresIn);
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
      // S4a (0085): a database without files.tags gets the patch without it.
      // A patch that was ONLY tags refuses in words — a silent no-op would
      // leave the chip lit until the next list (the 0075 trap, again).
      if ('tags' in row && !(await fileTagsAvailable(client))) {
        delete row.tags;
        const left = Object.keys(row).filter((k) => k !== 'project_id');
        if (left.length === 0) {
          throw new Error('[supabase] Tags are not on this database yet (migration 0085). Nothing was changed.');
        }
      }
      const res = await client.from('files').update(row).eq('id', id).select().single();
      // S4b (0088): the two Legal CHECKs answer in Postgres's words; say what
      // they mean instead (a caller from another page may not have the row).
      const legalWhy = legalRefusalSentence(res.error?.message, patch);
      if (legalWhy) throw new Error(`[supabase] ${legalWhy}`);
      return unwrap(res);
    },

    // S4a: whether files.tags exists here (0085), for the file window.
    async supportsFileTags() {
      const client = await requireClient();
      return fileTagsAvailable(client);
    },

    // S4b: whether this database locks the LEGAL folder (0088) — Add files
    // offers "Legal" only when it does. `false` on any doubt.
    async supportsLegalFiles() {
      const client = await requireClient();
      return legalFilesAvailable(client);
    },

    // S4a (E13): opening a preview is a read, and a read leaves a record —
    // the same log_file_downloaded RPC downloadFile and downloadUrl call,
    // best-effort and never silent (rpc() resolves for every status, so
    // .error is checked). The provider calls it once per file per session.
    async logFileDownloaded(file) {
      const client = await requireClient();
      try {
        const logged = await client.rpc('log_file_downloaded', { p_file_id: file.id });
        if (logged.error) console.warn('[supabase] preview not logged:', logged.error.message);
        return !logged.error;
      } catch (err) {
        console.warn('[supabase] preview not logged:', err?.message || err);
        return false;
      }
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
      // 0090 (S5b): a task the open bid version does not hold is SET ASIDE —
      // hidden everywhere, this cross-project list included. RLS does not
      // hide it (it must stay readable to come back), so it is left out
      // here, on the client side of the read: a database without 0090 has no
      // such column and answers exactly as before.
      return (data ?? []).filter(t => !isSetAside(t));
    },

    // Phase labels for the Dashboard's phase grouping (assets carry
    // phase_id; the names live here). `*` rather than four columns so the
    // set-aside stamp (0090) comes back where it exists, and is left out.
    async listPhasesByProjects(projectIds) {
      if (!projectIds?.length) return [];
      const client = await requireClient();
      const { data, error } = await client
        .from('phases')
        .select('*')
        .in('project_id', projectIds);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        lastError = error.message || String(error);
        throw new Error(`[supabase] ${lastError}`);
      }
      lastError  = null;
      lastSyncAt = new Date();
      return (data ?? []).filter(p => !isSetAside(p));
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
    // wrong until B1 (an RPC failure and an empty workspace were
    // indistinguishable at every call site; it returns `error` now).

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
    // Post-overhaul S5: change ONLY the columns named, as an UPDATE (S3b's
    // patchShotList shape). upsertBudgetVersion is whole-row, so a stale row
    // re-sent erased a newer summary or shot_list_id (S3a's trap with lists).
    // An UPDATE the money gate does not let through matches nothing and
    // returns no row — not an error — so no row back is the refusal.
    async patchBudgetVersion(projectId, id, patch) {
      const client = await requireClient();
      const cols = toColumns('budget_versions', blankDatesToNull(sanitize(patch, ['id', 'project_id', 'workspace_id', 'created_at', 'updated_at', 'created_by', 'updated_by'])));
      if (!cols || Object.keys(cols).length === 0) return null;
      const rows = unwrap(await client.from('budget_versions').update(cols)
        .eq('id', id ?? null).eq('project_id', projectId ?? null).select());
      if (!Array.isArray(rows) || rows.length === 0) {
        const err = new Error('[supabase] you cannot change this bid version');
        err.code = '42501';
        throw err;
      }
      return rows[0];
    },
    // The SELECTED bid (budget_versions.is_active — the variance baseline) in
    // ONE statement: 0089's select_budget_version, SECURITY INVOKER, so the
    // money gate's own policies apply. null clears it. Answers the id.
    async selectBudgetVersion(projectId, versionId) {
      const client = await requireClient();
      const selected = unwrap(await client.rpc('select_budget_version', {
        p_project: projectId ?? null, p_version: versionId ?? null,
      }));
      return selected ?? null;
    },

    // 0090 (S5b): set tasks, phases and key dates aside (on) or bring them
    // back (off) — the open bid version decides which. ONE RPC, one
    // transaction for the three tables; money-gated in the database (the
    // RPC's own check and trg_*_set_aside_guard). Returns the stamp it wrote
    // (null when bringing back) and how many rows of each changed.
    async setAsideRows(projectId, { on, tasks = [], phases = [], milestones = [] } = {}) {
      const client = await requireClient();
      const res = unwrap(await client.rpc('set_aside_schedule_rows', {
        p_project: projectId ?? null, p_on: !!on,
        p_tasks: tasks, p_phases: phases, p_milestones: milestones,
      })) || {};
      return {
        set_aside_at: res.set_aside_at ?? null,
        tasks: Number(res.tasks) || 0, phases: Number(res.phases) || 0, milestones: Number(res.milestones) || 0,
      };
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

    // The per-entity folder (ensureEntityFolderWith, module-level, above):
    // five scenes means five folders under SCENES/; a shot's folder sits in
    // its scene's (S4c); an existing folder keeps its parent.
    async ensureEntityFolder(projectId, project, entityType, entity) {
      const client = await requireClient();
      return ensureEntityFolderWith(client, projectId, project, entityType, entity);
    },

    // ── S4c: the one-time re-filing of a project's shot folders ─────────
    // What is pending is read from the rows (shotRefiling.pendingShotRefiling);
    // each shot is moved whole (refileOneShot: checked first, each object
    // moved, seen and its row rewritten at once, the folder re-parented
    // last) and a failure in one shot leaves it where it is, named with its
    // reason, while the others go on. `onProgress({ shot, done, total })`
    // before each shot. One run per project at a time in this tab.
    // The database refuses this for anyone who cannot write the project:
    // folders_update and files_update (0041, 0083) and the storage UPDATE
    // policies (0042, 0053) all demand can_write_project.
    async refileShotFolders(projectId, project, opts = {}) {
      if (refilingNow.has(projectId)) throw new Error('The move is already running for this project.');
      refilingNow.add(projectId);
      try {
        const client = await requireClient();
        const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
        const folders = await listFoldersWith(client, projectId);
        const shots = await readAllPages(() => client.from('shots').select('id, name, scene_id').eq('project_id', projectId).order('id'));
        const scenes = await readAllPages(() => client.from('scenes').select('id, name').eq('project_id', projectId).order('id'));
        const pending = pendingShotRefiling({ folders, shots, scenes });
        const moved = [];
        const left = [];
        for (const p of pending) {
          progress({ shot: p.shot, name: p.folder.slug, done: moved.length + left.length, total: pending.length });
          try {
            const { files, toPath } = await refileOneShot(client, projectId, project, p);
            moved.push({ shotId: p.shot.id, name: p.folder.slug, from: p.folder.path, to: toPath, files });
          } catch (err) {
            left.push({ shotId: p.shot.id, name: p.folder.slug, from: p.folder.path, reason: err?.message || String(err) });
          }
        }
        // The empty SHOTS category goes only once nothing is left under it:
        // counted in the database, and said to be gone only when the delete
        // answers the row (an RLS-filtered delete answers none).
        let removedShotsCategory = false;
        const category = shotsCategoryRow(folders);
        if (category) {
          const under = await client.from('folders')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .like('path', 'SHOTS/%');
          if (!under.error && under.count === 0) {
            const del = await client.from('folders').delete().eq('id', category.id).select('id');
            removedShotsCategory = !del.error && Array.isArray(del.data) && del.data.length > 0;
          }
        }
        return { moved, left, removedShotsCategory };
      } finally {
        refilingNow.delete(projectId);
      }
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

    // ── Milestones (0067) ─────────────────────────────────────
    //
    // Session A2s2 — ruling 26 ("build cloud milestones like scenes and levels
    // got") and ruling 38 (trash + undo). These two methods threw "table not
    // yet created" until 0067; there was no list method and no `milestones`
    // key in loadProject, so the cloud timeline drew none and every create
    // raised.
    //
    // Shape matches localServerAdapter exactly: list(projectId), upsert(row),
    // delete(id, projectId). The projectId on delete is unused here — the id
    // is a UUID primary key and RLS already scopes it to the caller's
    // workspace — but it is in the signature for interface parity, as
    // deleteScene's is.
    //
    // Every upsert runs toColumns: RabbitProvider.updateMilestone re-sends the
    // WHOLE existing row merged with the patch, so any key the row picked up
    // elsewhere would PGRST204 the entire write without it. That is exactly
    // how task creation broke in S23.
    async listMilestones(projectId) {
      const client = await requireClient();
      return unwrapOptionalTable(await client.from('milestones').select('*')
        .eq('project_id', projectId).order('date').order('id'));
    },
    async upsertMilestone(milestone) {
      const client = await requireClient();
      const row = toColumns('milestones', blankDatesToNull(sanitize(milestone, ['set_aside_at'])));
      return unwrap(await client.from('milestones').upsert(row).select().single());
    },
    // 🚨 THE OTHER HALF OF LWW, and 0077 is why it is needed (R2).
    // realtimeMerge's header states the contract in two parts: the pending-set
    // protects the local bundle from an incoming row, and per-field PATCHes
    // keep the DB row itself a per-field merge. Milestones had only ever been
    // written as whole-row upserts, which was harmless while nothing else could
    // be writing them at the same moment. With key dates live, A renaming one
    // while B moves its date meant B's upsert shipped B's stale copy of `title`
    // and reverted the rename — last-ROW-wins, not last-FIELD-wins. The
    // provider prefers this method when present, exactly as it does patchTask;
    // localServerAdapter deliberately keeps the upsert, because its PATCH route
    // would have to live in electron/main.cjs (Track B's file) and the desktop
    // has no broadcast to race with in the first place.
    async patchMilestone(id, patch) { return patchRow('milestones', id, patch); },
    // 🚨 SOFT delete, unlike deleteScene's hard one. Ruling 38 asks for trash
    // and undo, and 0067 gave milestones deleted_at from day one. The RPC is
    // the only path in: a plain UPDATE setting deleted_at is refused, because
    // Postgres applies milestones_select to the NEW row and the new row is
    // trashed and therefore invisible (0014 measured that live on wilson-dev).
    async deleteMilestone(id, _projectId) {
      const client = await requireClient();
      return unwrap(await client.rpc('soft_delete_row', { p_table: 'milestones', p_id: id }));
    },
    // `_projectId` is unused here (the id is a UUID primary key and RLS scopes
    // it), but the local adapter needs it to address its bundle, so both take
    // it and the provider has ONE call shape — the deleteScene precedent.
    // The HARD delete, used by exactly one caller: RabbitProvider's undo of a
    // CREATE. Undoing a create must leave no trace — no row, no trash entry —
    // whereas deleting an existing key date must be recoverable. Both are
    // policed by milestones_delete, which the ordinary delete never reaches
    // because it goes through the trash RPC instead.
    async destroyMilestone(id, _projectId) {
      const client = await requireClient();
      unwrap(await client.from('milestones').delete().eq('id', id));
    },
    async restoreMilestone(id, _projectId) {
      const client = await requireClient();
      // Returns the RPC's boolean: false = the row was already live (someone
      // else restored it first) — callers must not treat that as a fresh
      // restore. Same contract as restoreAsset (Session 7 review finding).
      return unwrap(await client.rpc('restore_soft_deleted', { p_table: 'milestones', p_id: id }));
    },
    // "Recently deleted". NOT a table read: milestones_select filters
    // deleted_at, so a trashed row is invisible through the table by design —
    // which is what keeps it off the timeline. 0067's SECURITY DEFINER index
    // is the read path, and it carries purges_at for the 30-day countdown.
    async listTrashedMilestones(projectId) {
      const client = await requireClient();
      // 🚨 THIS IS AN RPC, NOT A TABLE READ, so unwrapOptionalTable is the
      // wrong helper: it absorbs 42P01 / PGRST205, which are a missing
      // RELATION, and PostgREST answers a missing FUNCTION with PGRST202
      // (42883 from Postgres itself). The first version of this method used it
      // and carried a comment claiming a client deployed ahead of 0067 would
      // see an empty trash; it would in fact have seen an error. R1 caught the
      // comment being false rather than the code being subtle.
      //
      // Absorbed narrowly, and ONLY the missing-function codes: a permission
      // failure or a network fault must still reach the panel, which
      // distinguishes "could not look" from "nothing here".
      const { data, error } = await client.rpc(
        'milestones_trash_index', { p_project_id: projectId });
      if (error) {
        // 🚨 NARROWED, and the narrowing matters. PostgREST surfaces the
        // Postgres code, so a 42883 raised INSIDE this function's body — a
        // helper dropped or re-signatured — would otherwise be turned into
        // "the trash is empty", which is the exact conflation the comment
        // above says this method avoids. Only a missing
        // milestones_trash_index degrades; anything else reaches the panel.
        const msg = error.message || String(error);
        const missingFn = (error.code === 'PGRST202')
          || (error.code === '42883' && msg.includes('milestones_trash_index'));
        if (missingFn) { lastError = null; lastSyncAt = new Date(); return []; }
        lastError = msg;
        throw new Error(`[supabase] ${lastError}`);
      }
      // The bookkeeping every other path in this file does. Without it a
      // failing trash read leaves a stale lastError, and status() reports it
      // (and a stale lastSyncAt) as the adapter's health.
      lastError  = null;
      lastSyncAt = new Date();
      return data || [];
    },

    // ── Shot lists, items and edits (0084, post-overhaul S3a) ─────────
    //
    // The S3a contract's nine methods, round 1's two membership deltas
    // (addendum A) and round 2's reorder (R2-2) — the same names, signatures
    // and row shapes on localServerAdapter and the fixtures adapter.
    //
    //   D1 + D3   a list is MEMBERSHIP. Nothing here copies a scene or shot:
    //             the four item writes write rows that point at the shared
    //             scene / shot rows.
    //   R1 (A)    membership is written as DELTAS — upsertShotListItems,
    //             repositionShotListItems and deleteShotListItems touch only
    //             the rows they name. Items are not broadcast, so a whole-set
    //             replace from one client's view deleted what a collaborator
    //             had added since it loaded. replaceShotListItems stays for
    //             tooling and bulk restores.
    //   R2-2      a REORDER only moves rows that exist: an upsert from a stale
    //             view re-inserted what a collaborator had removed.
    //   R2-1      an ARCHIVED list's membership is NOT frozen (round 1's
    //             freeze is reverted: it made the undo of a scene delete drop
    //             that scene from every archived list for good). The provider
    //             refuses UI verbs on an archived list; undo and restore may
    //             write it, here as on the other backends.
    //   D4 / D18  lists and edits are ARCHIVED, never deleted. There is no
    //             delete method, and 0084 grants no DELETE on either table.
    //   D8        set-active and archive go through the three SECURITY
    //             DEFINER RPCs. Their seat check (workspace admin or PROJECT
    //             manager) is the database's; a refusal reaches the caller as
    //             `[supabase] <the SQL message>` with err.code 42501.
    //
    // On a database without 0084 the READS answer [] — the same answer
    // loadProject gives, since two answers to one question is the defect
    // googleDriveAdapter's listFolders comment names — and every WRITE throws
    // code `shot_lists_unavailable` (see shotListsAbsent).
    //
    // The projectId argument is unused by the item and archive calls: each
    // RPC resolves the list's (or edit's) project itself, under RLS, and the
    // item DELETE is filtered by the list. It is in the signature for parity,
    // as deleteScene's is.
    //
    // 🚨 Every RPC parameter is SENT, as null when the caller has no value —
    // never left undefined. JSON drops an undefined key, PostgREST resolves a
    // function by the parameter NAMES it receives, and a missing name is
    // answered PGRST202: the code that means "0084 is not here". A null id
    // instead reaches the function and comes back as its own "not found".
    async listShotLists(projectId) {
      const client = await requireClient();
      return listShotListsWith(client, projectId);
    },
    async upsertShotList(list) {
      requireProjectIdOn(list, 'a shot list');
      const client = await requireClient();
      requireShotLists();
      // The provider re-sends whole rows. The six server-owned columns are
      // stripped first (addendum F, SHOT_LIST_SERVER_OWNED), then toColumns
      // keeps exactly the table's columns. Nothing is re-validated here: the
      // provider refuses a blank title, a bad version and a duplicate
      // "Title · vN" with shotListModel's sentences BEFORE its optimistic
      // write, and the database refuses the same things behind it — with its
      // own CHECK messages for the first two (23514), with "There is already
      // a shot list with this title and version." for the third (23505,
      // worded by shotListUniqueSentence, R2-3 — the fallback when the
      // provider's view was stale), and with the contract's sentence (42501,
      // trg_shot_lists_guard) for a row that is archived in the database,
      // stale copy or not. The trade-off F accepts:
      // an archived_at a caller puts in the body is not sent, so it can
      // neither archive a list here nor be refused for trying — archiving is
      // archiveShotList's alone, and the provider has no other path to it.
      const row = toColumns('shot_lists', blankDatesToNull(sanitize(list, SHOT_LIST_SERVER_OWNED)));
      return unwrapShotList(
        await client.from('shot_lists').upsert(row).select().single(),
        missing0084Table,
      );
    },
    // Post-overhaul S3b — the patch path S3a's "Known limits" asked for
    // before any rename reached the UI: change ONLY the columns named, as an
    // UPDATE, so nothing the caller did not name (a collaborator's newer
    // summary, a Save this client never saw) is re-sent from its stale view.
    // An upsert cannot be a patch here: it must carry the NOT NULL title
    // (23502). Never sent: the six server-owned columns, and the row's
    // identity (it is the filter). An UPDATE that RLS does not let through
    // matches nothing and returns no row — not an error — so no row back is
    // the contract's refusal sentence. The database's guard and unique index
    // answer as for an upsert (unwrapShotList).
    async patchShotList(projectId, listId, patch) {
      const client = await requireClient();
      requireShotLists();
      const cols = toColumns('shot_lists', blankDatesToNull(sanitize(patch, [...SHOT_LIST_SERVER_OWNED, 'id', 'project_id', 'workspace_id'])));
      if (!cols || Object.keys(cols).length === 0) return null;
      const rows = unwrapShotList(
        await client.from('shot_lists').update(cols).eq('id', listId ?? null).eq('project_id', projectId ?? null).select(),
        missing0084Table,
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        const err = new Error('[supabase] you cannot change this shot list');
        err.code = '42501';
        throw err;
      }
      return rows[0];
    },
    async listShotListItems(projectId) {
      const client = await requireClient();
      return listShotListItemsWith(client, projectId);
    },
    // The WHOLE membership of one list in one transaction (0084 §10d), for
    // tooling and bulk restores — the provider writes deltas (below). Over
    // plain PostgREST a whole-set swap would be a delete plus an upsert in two
    // requests that can half-land. replace_shot_list_items is SECURITY
    // INVOKER, so every row it touches passes shot_list_items' own policies —
    // it grants nothing. p_items: see shotListItemsParam.
    async replaceShotListItems(_projectId, listId, items) {
      const client = await requireClient();
      requireShotLists();
      const rows = unwrapShotList(
        await client.rpc('replace_shot_list_items', { p_list: listId ?? null, p_items: shotListItemsParam(items) }),
        missing0084Function('replace_shot_list_items'),
      );
      return rows || [];
    },
    // Addendum A, the delta write: insert the named rows (a new id, or none =
    // new) and update the named rows of THIS list — scene_id / shot_id /
    // position — in one statement, as the caller (upsert_shot_list_items,
    // 0084 §10e, SECURITY INVOKER). It deletes nothing, so nothing a
    // collaborator added is touched. An id that belongs to ANOTHER list is
    // skipped by the function's ON CONFLICT … WHERE and is absent from the
    // rows returned. Exactly-one, same-project, position ≥ 0 and each scene
    // and shot once are the table's CHECKs, composite FKs and unique indexes
    // (23514 / 23503 / 23505 on err.code — the last worded as the contract
    // words it); a caller without write rights is refused by its policies
    // (42501). p_positions_only is SENT as false although it defaults to
    // false: this is the arm that INSERTS, and saying so in the request
    // keeps it from ever riding on a default (R2-2).
    async upsertShotListItems(_projectId, listId, items) {
      const client = await requireClient();
      requireShotLists();
      const rows = unwrapShotList(
        await client.rpc('upsert_shot_list_items', {
          p_list: listId ?? null, p_items: shotListItemsParam(items), p_positions_only: false,
        }),
        missing0084Function('upsert_shot_list_items'),
      );
      return rows || [];
    },
    // R2-2, the REORDER (and its undo / redo): set `position` on rows that
    // EXIST in THIS list and change nothing else — upsert_shot_list_items
    // with p_positions_only = true, an UPDATE … RETURNING. An id that names
    // no row (one a collaborator removed since this client loaded) or
    // another list's row is skipped, never inserted: as an upsert, a reorder
    // planned from a stale view put every such row back (r2 sql2#1,
    // provider2#2, parity2#0). Items [{ id, position }]; anything else on
    // them is not sent. Refused before any request (repositionItemsParam):
    // not an array, an item without an id, a position that is not a whole
    // number ≥ 0, an id named twice. Returns the rows updated. An empty
    // payload still asks, so a missing list answers "shot list not found".
    async repositionShotListItems(_projectId, listId, items) {
      const client = await requireClient();
      requireShotLists();
      const p_items = repositionItemsParam(items);
      const rows = unwrapShotList(
        await client.rpc('upsert_shot_list_items', {
          p_list: listId ?? null, p_items, p_positions_only: true,
        }),
        missing0084Function('upsert_shot_list_items'),
      );
      return rows || [];
    },
    // Addendum A, the other delta: delete exactly the named items of THIS
    // list; ids not in it are ignored. A filtered DELETE — the list filter is
    // what leaves another list's item alone even when its id is named — and
    // `.select('id')`, so the answer is what was really deleted, not what was
    // asked for. A shortfall is explained (explainItemDeleteShortfall): RLS
    // filters a DELETE rather than refusing it, so a caller without write
    // rights must hear 42501, not an empty success.
    async deleteShotListItems(_projectId, listId, itemIds) {
      const client = await requireClient();
      requireShotLists();
      if (!Array.isArray(itemIds)) {
        throw shotListRefusal('itemIds must be an array of shot list item ids', 'invalid');
      }
      // No list id: nothing can be in it, and `.eq('shot_list_id', null)`
      // would reach PostgREST as the TEXT 'null' and come back as a uuid cast
      // error. The RPCs' own sentence for a list that is not there.
      if (!listId) throw shotListRefusal('shot list not found', 'P0002');
      const ids = [...new Set(itemIds.filter(id => id != null && id !== ''))];
      if (ids.length === 0) return { deleted: [] };
      const rows = unwrapShotList(
        await client.from('shot_list_items').delete()
          .eq('shot_list_id', listId).in('id', ids).select('id'),
        missing0084Table,
      );
      const deleted = (rows || []).map(r => r.id);
      if (deleted.length < ids.length) await explainItemDeleteShortfall(client, listId, ids, deleted);
      return { deleted };
    },
    async listEdits(projectId) {
      const client = await requireClient();
      return listEditsWith(client, projectId);
    },
    async upsertEdit(edit) {
      requireProjectIdOn(edit, 'an edit');
      const client = await requireClient();
      requireShotLists();
      // `items` is one jsonb array (0084 §5); toColumns does not reach inside
      // it. The six server-owned columns are stripped first, for
      // upsertShotList's reasons (addendum F). The same-list parent, the one
      // chain (edits_one_root_per_list_key / edits_one_child_key, 23505,
      // answered in the contract's chain sentences — R2-3), a duplicate
      // "Title · vN" (edits_list_title_version_key, likewise), the fixed
      // parent, a parent that does not exist yet (R2-6), the no-move rule and
      // the archive rules are the database's (edits_parent_same_list_fk,
      // trg_edits_guard).
      const row = toColumns('edits', blankDatesToNull(sanitize(edit, SHOT_LIST_SERVER_OWNED)));
      return unwrapShotList(
        await client.from('edits').upsert(row).select().single(),
        missing0084Table,
      );
    },
    // null clears the pointer (back to "no active list": every scene and shot
    // shows, D10). Returns the new active id, or null.
    async setActiveShotList(projectId, listId) {
      const client = await requireClient();
      requireShotLists();
      const active = unwrapShotList(
        await client.rpc('set_active_shot_list', { p_project: projectId ?? null, p_list: listId ?? null }),
        missing0084Function('set_active_shot_list'),
      );
      return active ?? null;
    },
    // archived = false restores. The RPC is idempotent and refuses the ACTIVE
    // list. `null` archives, as the SQL's COALESCE(p_archived, true) does.
    async archiveShotList(_projectId, listId, archived = true) {
      const client = await requireClient();
      requireShotLists();
      return unwrapShotList(
        await client.rpc('archive_shot_list', {
          p_list: listId ?? null, p_archived: archived == null ? true : Boolean(archived),
        }),
        missing0084Function('archive_shot_list'),
      );
    },
    async archiveEdit(_projectId, editId, archived = true) {
      const client = await requireClient();
      requireShotLists();
      return unwrapShotList(
        await client.rpc('archive_edit', {
          p_edit: editId ?? null, p_archived: archived == null ? true : Boolean(archived),
        }),
        missing0084Function('archive_edit'),
      );
    },

    // ── Bins on the cloud (BC1, migration 0091) ───────────────
    //
    // The Local Server adapter's names and shapes (localServerAdapter.js's
    // bins block; electron/rabbitBins.cjs is the contract), over the four
    // cloud tables and the eleven RPCs. Every method takes projectId first.
    // Reads answer [] on a database without 0091; writes refuse with
    // `bins_unavailable` before any request (see binsAbsent). What the cloud
    // cannot do answers `not_supported_here` — the capability object says
    // which (binsCapabilities).
    //
    // 🚨 Every RPC parameter is SENT, as null when the caller has no value —
    // never left undefined (the 0084 rule: a missing name is PGRST202, which
    // reads as "0091 is not here").
    binsCapabilities() { return CLOUD_BINS_CAPABILITIES; },

    async listBins(projectId) {
      const client = await requireClient();
      const [bins, binFiles, shotTakes, binLocations] = await Promise.all([
        listBinsWith(client, projectId),
        listBinFilesWith(client, projectId),
        listShotTakesWith(client, projectId),
        listBinLocationsWith(client),
      ]);
      // No `online` on the rows: the cloud does not know what this computer
      // can reach (the provider marks them from the capability object). No
      // orphans: the FKs cascade, so every take's shot and file exist.
      return { bins, binFiles, binRoots: [], binLocations, shotTakes, orphanTakes: [], ffmpeg: false, capabilities: CLOUD_BINS_CAPABILITIES };
    },
    async createBin(projectId, bin) {
      const client = await requireClient();
      requireBins();
      const name = String(bin?.name ?? '').trim();
      if (!name) throw binsRefusal(BINS_REFUSALS.binName, 'invalid');
      const row = toColumns('bins', sanitize({ ...bin, name, project_id: projectId }, BIN_SERVER_OWNED));
      if (!BIN_KINDS_0091.includes(row.kind)) row.kind = 'other';
      if (row.parent_bin_id === undefined || row.parent_bin_id === '') row.parent_bin_id = null;
      if (!Number.isFinite(Number(row.sort_order)) || row.sort_order === null || row.sort_order === undefined) {
        // The next slot among its siblings (the Local Server's nextSortOrder).
        let q = client.from('bins').select('sort_order').eq('project_id', projectId);
        q = row.parent_bin_id ? q.eq('parent_bin_id', row.parent_bin_id) : q.is('parent_bin_id', null);
        const siblings = unwrapBins(await q.order('sort_order', { ascending: false }).limit(1), missing0091Table) || [];
        row.sort_order = siblings.length ? Number(siblings[0].sort_order || 0) + 1 : 0;
      }
      return unwrapBins(await client.from('bins').upsert(row).select().single(), missing0091Table);
    },
    async updateBin(projectId, id, patch) {
      const client = await requireClient();
      requireBins();
      const p = { ...(patch || {}) };
      if ('name' in p) { p.name = String(p.name ?? '').trim(); if (!p.name) throw binsRefusal(BINS_REFUSALS.binName, 'invalid'); }
      if ('kind' in p && !BIN_KINDS_0091.includes(p.kind)) p.kind = 'other';
      if ('parent_bin_id' in p && !p.parent_bin_id) p.parent_bin_id = null;
      const cols = toColumns('bins', sanitize(p, [...BIN_SERVER_OWNED, 'id', 'project_id', 'workspace_id']));
      if (!cols || Object.keys(cols).length === 0) return null;
      const rows = unwrapBins(
        await client.from('bins').update(cols).eq('id', id ?? null).eq('project_id', projectId ?? null).select(),
        missing0091Table,
      );
      // An UPDATE that RLS does not let through matches nothing and returns
      // no row — not an error (the S3b patch rule): no row back is the refusal.
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.gate, '42501');
      return rows[0];
    },
    // mode 'move' needs target (the bin that receives the files); 'remove'
    // drops the rows. → { ok, removedBins, movedFiles, removedFiles, removedTakes }
    // — removedTakes is the cloud's extra: the FKs cascade, so the takes of a
    // removed clip go with it, and the provider's undo puts them back through
    // replaceShotTakes.
    async deleteBin(_projectId, id, { mode = 'remove', target = null } = {}) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('delete_bin', { p_bin: id ?? null, p_mode: mode === 'move' ? 'move' : 'remove', p_target: target ?? null }),
        missing0091Function('delete_bin'),
      );
      return res || { ok: true, removedBins: [], movedFiles: [], removedFiles: [], removedTakes: [] };
    },
    async reorderBins(_projectId, order) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('reorder_bins', { p_order: Array.isArray(order) ? order : null }),
        missing0091Function('reorder_bins'),
      );
      return res || { ok: true, bins: [] };
    },
    // The OS dialogs, the walk of a picked folder, a file's columns, its
    // bytes, the OS: the desktop's alone (CLOUD_BINS_CAPABILITIES).
    async pickBinFiles() { throw notSupportedHere('Picking files'); },
    async pickBinFolder() { throw notSupportedHere('Picking a folder'); },
    async prepareBinFiles() { throw notSupportedHere('Reading a folder'); },
    async probeBinFile() { throw notSupportedHere('Reading a file\'s columns'); },
    async openBinFile() { throw notSupportedHere('Opening a file'); },
    async binRelinkApply() { throw notSupportedHere('Relinking a drive'); },
    async removeBinRoot() { throw notSupportedHere('Forgetting a folder'); },
    // The view scans known roots on open; the cloud has none to scan.
    async binRelinkScan() { return { offline: [], candidates: null, truncated: false }; },
    // items: the rows as the adding computer described them, each with
    // location_id + relative_path (BC2 builds them from the desktop's
    // prepare); createSubBins nests a `sub_bin` path. `roots` is the
    // desktop's and is ignored here. → { created, bins, results }
    async addBinFiles(_projectId, binId, items, createSubBins = true) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('add_bin_files', {
          p_bin: binId ?? null,
          p_items: Array.isArray(items) ? items : null,
          p_create_sub_bins: createSubBins !== false,
        }),
        missing0091Function('add_bin_files'),
      );
      return res || { created: [], bins: [], results: [] };
    },
    async updateBinFile(projectId, id, patch) {
      const client = await requireClient();
      requireBins();
      const p = { ...(patch || {}) };
      if ('display_name' in p) { p.display_name = String(p.display_name ?? '').trim(); if (!p.display_name) throw binsRefusal(BINS_REFUSALS.clipName, 'invalid'); }
      const cols = toColumns('bin_files', sanitize(p, BIN_FILE_PATCH_DROP));
      if (!cols || Object.keys(cols).length === 0) return null;
      const rows = unwrapBins(
        await client.from('bin_files').update(cols).eq('id', id ?? null).eq('project_id', projectId ?? null).select(),
        missing0091Table,
      );
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.gate, '42501');
      return rows[0];
    },
    async bulkUpdateBinFiles(projectId, ids, patch) {
      const client = await requireClient();
      requireBins();
      if (!Array.isArray(ids) || ids.length === 0) throw binsRefusal('ids required', 'invalid');
      const cols = toColumns('bin_files', sanitize(patch || {}, BIN_FILE_PATCH_DROP));
      if (!cols || Object.keys(cols).length === 0) return { updated: [] };
      const rows = unwrapBins(
        await client.from('bin_files').update(cols).in('id', ids).eq('project_id', projectId ?? null).select(),
        missing0091Table,
      );
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.gate, '42501');
      return { updated: rows };
    },
    // sortOrders (optional, { id: n }): an undo puts rows back at their old
    // positions. → { moved: [{ id, from, sort_order }], binFiles }
    async moveBinFiles(_projectId, ids, binId, sortOrders = null) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('move_bin_files', {
          p_ids: Array.isArray(ids) ? ids : null,
          p_bin: binId ?? null,
          p_sort_orders: sortOrders && typeof sortOrders === 'object' ? sortOrders : null,
        }),
        missing0091Function('move_bin_files'),
      );
      return res || { moved: [], binFiles: [] };
    },
    async copyBinFiles(_projectId, ids, binId) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('copy_bin_files', { p_ids: Array.isArray(ids) ? ids : null, p_bin: binId ?? null }),
        missing0091Function('copy_bin_files'),
      );
      return res || { created: [] };
    },
    // Removes the ROWS only; the files on the server are the company's (B10).
    // The takes of those clips go with them (CASCADE) and are read FIRST, so
    // the answer carries them for the undo. → { removed, removedTakes }
    async removeBinFiles(projectId, ids) {
      const client = await requireClient();
      requireBins();
      if (!Array.isArray(ids) || ids.length === 0) throw binsRefusal('ids required', 'invalid');
      const removedTakes = unwrapBins(
        await client.from('shot_takes').select('*').in('bin_file_id', ids).eq('project_id', projectId ?? null),
        missing0091Table,
      ) || [];
      const removed = unwrapBins(
        await client.from('bin_files').delete().in('id', ids).eq('project_id', projectId ?? null).select(),
        missing0091Table,
      ) || [];
      // 🚨 RLS FILTERS a DELETE rather than refusing it (S3a, r2 closure#10):
      // nothing removed for ids that were given is the refusal, said.
      if (removed.length === 0) throw binsRefusal(BINS_REFUSALS.gate, '42501');
      return { removed, removedTakes };
    },
    // The undo of a removal: the rows go back with their ids and who added
    // them. → { restored, skipped: [{ id, reason: invalid | bin_gone }],
    // affectedShotIds: [], shotTakes: [], orphanTakes: [] } — the takes come
    // back through replaceShotTakes, not here.
    async restoreBinFiles(_projectId, rows) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('restore_bin_files', { p_rows: Array.isArray(rows) ? rows : null }),
        missing0091Function('restore_bin_files'),
      );
      return res || { restored: [], skipped: [], affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },
    // A renderer-decoded JPEG (the desktop's fallback poster, or BC2's) goes
    // to rabbit-thumbnails at projects/{project}/bin_files/{id}/{ts}-poster.jpg
    // and the row learns its key. The switch is asked FIRST (B4), so the
    // person reads the sentence and no byte moves while it is off; a storage
    // refusal that slips past the pre-check reads the same sentence.
    // → { ok: true, poster_path }
    async postBinFileThumbnail(projectId, id, base64) {
      const client = await requireClient();
      requireBins();
      const bytes = posterBytesFrom(base64);
      const allowed = unwrapBins(
        await client.rpc('rabbit_remote_viewing_enabled', { p_project: projectId ?? null }),
        missing0091Function('rabbit_remote_viewing_enabled'),
      );
      if (allowed !== true) throw binsRefusal(BINS_REFUSALS.remoteViewingOff, 'remote_viewing_off');
      const key = `projects/${projectId}/bin_files/${id}/${Date.now()}-poster.jpg`;
      const { error } = await client.storage.from(POSTER_BUCKET).upload(key, bytes, { contentType: 'image/jpeg', upsert: false });
      if (error) {
        const msg = /row-level security|petal_bin_posters/.test(error.message || '')
          ? BINS_REFUSALS.remoteViewingOff
          : `storage upload failed: ${error.message || error}`;
        const err = new Error(`[supabase] ${msg}`);
        err.code = /row-level security|petal_bin_posters/.test(error.message || '') ? 'remote_viewing_off' : 'storage';
        throw err;
      }
      try {
        await this.updateBinFile(projectId, id, { poster_path: key });
      } catch (e) {
        // The object just uploaded names nothing now, and the orphan scan
        // never walks this bucket (0091 §6) — take it back, best effort
        // (0053's rabbit_thumbnails_delete_own lets the uploader delete their
        // own object). The PATCH's refusal stays the answer (review round 1).
        try { await client.storage.from(POSTER_BUCKET).remove([key]); } catch { /* the refusal below is the answer */ }
        throw e;
      }
      return { ok: true, poster_path: key };
    },
    // The cloud signs a poster per read (the bucket is private, 0053): an
    // async URL, unlike the desktop's sync route URL. null when the row has
    // no picture or the read is refused (the view shows its placeholder).
    async binFilePosterUrl(_projectId, row, { expiresIn = 3600 } = {}) {
      const key = row?.poster_path;
      if (!key) return null;
      const client = await requireClient();
      const { data, error } = await client.storage.from(POSTER_BUCKET).createSignedUrl(key, expiresIn);
      if (error) return null;
      return data?.signedUrl || null;
    },
    // Sync URL builders: the cloud has no route to point an <img> or <video>
    // at — a poster is signed (binFilePosterUrl), bytes are the desktop's.
    binFileThumbnailUrl() { return null; },
    binFileStreamUrl() { return null; },

    // Footage locations (B2): the company's named shares. Every member reads
    // them; anyone past the gate on a project of the workspace writes them.
    async listBinLocations() {
      const client = await requireClient();
      return listBinLocationsWith(client);
    },
    async createBinLocation(location) {
      const client = await requireClient();
      requireBins();
      const name = String(location?.name ?? '').trim();
      const unc_path = String(location?.unc_path ?? '').trim();
      if (!name) throw binsRefusal(BINS_REFUSALS.locationName, 'invalid');
      if (!unc_path) throw binsRefusal(BINS_REFUSALS.locationShape, 'invalid');
      const row = toColumns('bin_locations', sanitize({ ...location, name, unc_path }, ['added_by', 'created_at', 'updated_at', 'workspace_id']));
      return unwrapBins(await client.from('bin_locations').insert(row).select().single(), missing0091Table);
    },
    async updateBinLocation(id, patch) {
      const client = await requireClient();
      requireBins();
      const p = { ...(patch || {}) };
      if ('name' in p) { p.name = String(p.name ?? '').trim(); if (!p.name) throw binsRefusal(BINS_REFUSALS.locationName, 'invalid'); }
      if ('unc_path' in p) { p.unc_path = String(p.unc_path ?? '').trim(); if (!p.unc_path) throw binsRefusal(BINS_REFUSALS.locationShape, 'invalid'); }
      const cols = toColumns('bin_locations', sanitize(p, ['id', 'workspace_id', 'added_by', 'created_at', 'updated_at']));
      if (!cols || Object.keys(cols).length === 0) return null;
      const rows = unwrapBins(await client.from('bin_locations').update(cols).eq('id', id ?? null).select(), missing0091Table);
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.locationsGate, '42501');
      return rows[0];
    },
    // Refused while any clip names it (ON DELETE RESTRICT): a clip never loses
    // its address. → the removed row
    async removeBinLocation(id) {
      const client = await requireClient();
      requireBins();
      const rows = unwrapBins(await client.from('bin_locations').delete().eq('id', id ?? null).select(), missing0091Table);
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.locationsGate, '42501');
      return rows[0];
    },
    // The admin's switch (B5a). Read for any project of the workspace; set by
    // a workspace admin (workspaces_admin_update, 0020) — anyone else's write
    // matches nothing and reads the sentence.
    async getRemoteViewingEnabled(projectId) {
      const client = await requireClient();
      const v = unwrapBins(
        await client.rpc('rabbit_remote_viewing_enabled', { p_project: projectId ?? null }),
        missing0091Function('rabbit_remote_viewing_enabled'),
      );
      return v === true;
    },
    // BC2: the same switch read for the WORKSPACE, where no project is open
    // (Settings, Storage). workspaces_select (0002) lets every active member
    // read their own company's row; another company's id reads as off.
    async getWorkspaceRemoteViewing(workspaceId) {
      const client = await requireClient();
      if (!workspaceId) return false;
      const { data, error } = await client.from('workspaces').select('remote_viewing_enabled').eq('id', workspaceId).maybeSingle();
      if (error) {
        if (error.code === '42703') return false; // a database without 0091's column
        throw new Error(`[supabase] ${error.message || error}`);
      }
      return data?.remote_viewing_enabled === true;
    },
    async setRemoteViewingEnabled(workspaceId, enabled) {
      const client = await requireClient();
      requireBins();
      const rows = unwrapBins(
        await client.from('workspaces').update({ remote_viewing_enabled: enabled === true }).eq('id', workspaceId ?? null).select('id, remote_viewing_enabled'),
        missing0091Table,
      );
      if (!Array.isArray(rows) || rows.length === 0) throw binsRefusal(BINS_REFUSALS.switchAdminOnly, '42501');
      return rows[0].remote_viewing_enabled === true;
    },

    // Shot takes: every mutation answers { affectedShotIds, shotTakes,
    // orphanTakes: [] } — the FULL row set of the shots it touched, because a
    // role change or a removal renumbers and re-roles the siblings; the
    // provider replaces those shots' rows (the Local Server's contract).
    async assignShotTakes(_projectId, assignments) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('assign_shot_takes', { p_assignments: Array.isArray(assignments) ? assignments : null }),
        missing0091Function('assign_shot_takes'),
      );
      return res || { created: [], skipped: [], affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },
    async updateShotTake(_projectId, id, patch) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('update_shot_take', { p_id: id ?? null, p_patch: patch && typeof patch === 'object' ? patch : null }),
        missing0091Function('update_shot_take'),
      );
      return res || { take: null, affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },
    async removeShotTakes(_projectId, ids) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('remove_shot_takes', { p_ids: Array.isArray(ids) ? ids : null }),
        missing0091Function('remove_shot_takes'),
      );
      return res || { removed: [], affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },
    async reorderShotTakes(_projectId, shotId, ids) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('reorder_shot_takes', { p_shot: shotId ?? null, p_ids: Array.isArray(ids) ? ids : null }),
        missing0091Function('reorder_shot_takes'),
      );
      return res || { affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },
    // The undo primitive: the given shots' rows become exactly `rows`.
    async replaceShotTakes(_projectId, shotIds, rows) {
      const client = await requireClient();
      requireBins();
      const res = unwrapBins(
        await client.rpc('replace_shot_takes', { p_shots: Array.isArray(shotIds) ? shotIds : null, p_rows: Array.isArray(rows) ? rows : null }),
        missing0091Function('replace_shot_takes'),
      );
      return res || { affectedShotIds: [], shotTakes: [], orphanTakes: [] };
    },

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
    // ── private projects (demo 2026-09-11) ──────────────────────────────────
    // Whether THIS database has 0072's column — ProjectsPage shows the
    // "private project" checkbox only when it does (and only on the desktop,
    // where the media has a home). Probed once per session; see
    // privateProjectsAvailable above.
    async supportsPrivateProjects() {
      const client = await getClient();
      if (!client) return false;
      return privateProjectsAvailable(client);
    },
  };
}
