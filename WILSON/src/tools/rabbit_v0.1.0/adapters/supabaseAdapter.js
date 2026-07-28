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

// Columns a per-field patch must never carry: identity/tenancy, audit
// stamps, and the trash columns (RPC-only under the 0014 policies — a
// plain UPDATE with deleted_at either 42501s or silently no-ops).
const PATCH_DROP = [
  'id', 'workspace_id', 'created_at', 'created_by',
  'updated_at', 'updated_by', 'last_updated_at', 'last_updated_by',
  'deleted_at', 'deleted_by',
];

// Session 7 (LWW per field, locked decision): updates send ONLY the changed
// columns. The pre-S7 shape — upserting the caller's whole merged row —
// silently clobbered every field a collaborator changed since this client's
// last read. patchRow is the generic engine behind the per-table patch*
// methods the provider prefers when present.
async function patchRow(table, id, patch) {
  const client = await requireClient();
  const row = sanitize(patch, PATCH_DROP);
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
      const [project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns] =
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
        ]);
      return { project, phases, assets, tasks, dependencies, taskLinks, files, assetVersions, comments, ingestionRuns };
    },

    async createProject(payload) {
      const client = await requireClient();
      const row = sanitize(payload, ['id', 'created_at', 'updated_at']);
      const data = unwrap(await client.from('projects').insert(row).select().single());
      return data;
    },

    async updateProject(id, patch) {
      const client = await requireClient();
      const row = sanitize(patch, PATCH_DROP);
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
      const row = sanitize(asset, ['created_at', 'updated_at']);
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
      const row = sanitize(task, ['created_at', 'updated_at']);
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
      const entity =
        scope.taskId  ? 'tasks'  :
        scope.assetId ? 'assets' :
        scope.phaseId ? 'phases' :
        'project';
      const entityId = scope.taskId || scope.assetId || scope.phaseId || projectId;
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
      };
      return unwrap(await client.from('files').insert(row).select().single());
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
