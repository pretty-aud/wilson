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
// those are now real. What remains genuinely unbacked is scene/shot/level/
// experience (no cloud tables until S24 — the adapter throws for them) and
// task_template_id (listProjectTaskTemplates is localServer-only, so the
// dropdown is permanently empty in cloud).
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
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'last_updated_at', 'last_updated_by', 'deleted_at', 'deleted_by',
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

const COLUMN_ALLOWLIST = {
  tasks: TASK_COLUMNS,
  assets: ASSET_COLUMNS,
  projects: PROJECT_COLUMNS,
  budget_lines: BUDGET_LINE_COLUMNS,
  budget_actuals: BUDGET_ACTUAL_COLUMNS,
  budget_versions: BUDGET_VERSION_COLUMNS,
  expenses: EXPENSE_COLUMNS,
  project_rate_overrides: PROJECT_RATE_OVERRIDE_COLUMNS,
};

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

function toColumns(table, obj) {
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
      const [project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns, budgetVersions, expenses, projectMembers] =
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
        ]);
      return {
        project, phases, assets, tasks, dependencies, taskLinks, files,
        assetVersions, comments, ingestionRuns, budgetVersions, expenses,
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
      const entity =
        scope.financial ? 'INVOICES' :
        scope.taskId    ? 'tasks'  :
        scope.assetId   ? 'assets' :
        scope.phaseId   ? 'phases' :
        'project';
      const entityId = scope.financial
        ? (scope.lineId || projectId)
        : (scope.taskId || scope.assetId || scope.phaseId || projectId);
      const safeName = (file?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const storagePath = `projects/${projectId}/${entity}/${entityId}/${Date.now()}-${safeName}`;

      const { error: upErr } = await client
        .storage
        .from('rabbit-files')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file?.type || 'application/octet-stream',
        });
      if (upErr) {
        lastError = upErr.message;
        throw new Error(`[supabase] storage upload failed: ${upErr.message}`);
      }

      const row = {
        project_id:       projectId,
        phase_id:         scope.phaseId || null,
        asset_id:         scope.assetId || null,
        task_id:          scope.taskId  || null,
        name:             file?.name || safeName,
        mime_type:        file?.type || null,
        size_bytes:       file?.size ?? null,
        storage_provider: 'supabase',
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
        try { await client.storage.from('rabbit-files').remove([storagePath]); } catch { /* GC catches it */ }
      }
      return unwrap(ins);
    },

    async listFiles(projectId) {
      const client = await requireClient();
      return unwrap(await client.from('files').select('*').eq('project_id', projectId));
    },

    async downloadFile(file) {
      const client = await requireClient();
      const { data, error } = await client.storage.from('rabbit-files').download(file.storage_path);
      if (error) throw new Error(`[supabase] download failed: ${error.message}`);
      return data; // Blob
    },

    async updateFile(id, patch) {
      const client = await requireClient();
      return unwrap(await client.from('files').update(sanitize(patch, ['id', 'uploaded_at'])).eq('id', id).select().single());
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

    // ── Scenes (tables pending — Phase 2) ─────────────────────
    async upsertScene()  { throw new Error('[supabase] scenes table not yet created — use local_server adapter'); },
    async deleteScene()  { throw new Error('[supabase] scenes table not yet created — use local_server adapter'); },

    // ── Shots (tables pending — Phase 2) ─────────────────────
    async upsertShot()   { throw new Error('[supabase] shots table not yet created — use local_server adapter'); },
    async deleteShot()   { throw new Error('[supabase] shots table not yet created — use local_server adapter'); },

    // ── Levels (tables pending — Phase 2) ────────────────────
    async upsertLevel()  { throw new Error('[supabase] levels table not yet created — use local_server adapter'); },
    async deleteLevel()  { throw new Error('[supabase] levels table not yet created — use local_server adapter'); },

    // ── Experiences (tables pending — Phase 2) ───────────────
    async upsertExperience() { throw new Error('[supabase] experiences table not yet created — use local_server adapter'); },
    async deleteExperience() { throw new Error('[supabase] experiences table not yet created — use local_server adapter'); },

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
