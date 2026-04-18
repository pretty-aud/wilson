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
// Realtime: subscribeProjectChanges() opens one channel per project
// and subscribes to postgres_changes on phases/assets/tasks/files
// scoped to that project_id. The collab UI in v0.2 will consume
// these — RABBIT v0.1 wires them so the cost of opting in later
// is a single feature flag.
//
// History: the Session 1 scaffolding kept a per-project `supabase.json`
// fallback so pre-migration tenants could keep running. Session 2
// removed that fallback: every query now carries the user's JWT and
// is scoped by RLS (see supabase/migrations/0004_rls_rabbit.sql).

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
      const row = sanitize(patch, ['id', 'created_at', 'updated_at']);
      return unwrap(await client.from('projects').update(row).eq('id', id).select().single());
    },

    async deleteProject(id) {
      const client = await requireClient();
      unwrap(await client.from('projects').delete().eq('id', id));
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
    async deletePhase(id) {
      const client = await requireClient();
      unwrap(await client.from('phases').delete().eq('id', id));
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
    async deleteAsset(id) {
      const client = await requireClient();
      unwrap(await client.from('assets').delete().eq('id', id));
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
    async deleteTask(id) {
      const client = await requireClient();
      unwrap(await client.from('tasks').delete().eq('id', id));
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
      // Best-effort: fetch the row first so we can also remove the storage object.
      const { data: row } = await client.from('files').select('storage_path').eq('id', id).maybeSingle();
      if (row?.storage_path) {
        await client.storage.from('rabbit-files').remove([row.storage_path]).catch(() => {});
      }
      unwrap(await client.from('files').delete().eq('id', id));
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
      unwrap(await client.from('comments').delete().eq('id', id));
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
      unwrap(await client.from('rate_cards').delete().eq('id', id));
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

    // ── Realtime ──────────────────────────────────────────────
    // Wires postgres_changes on the four core tables scoped to a
    // single project_id. The collab UI in v0.2 can flip a feature
    // flag to start consuming these events without any wiring work.
    subscribeProjectChanges(projectId, callback) {
      let cancelled = false;
      let channel = null;

      (async () => {
        const client = await getClient();
        if (!client || cancelled) return;
        channel = client
          .channel(`rabbit-project-${projectId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
              (payload) => callback({ table: 'projects', ...payload }))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'phases', filter: `project_id=eq.${projectId}` },
              (payload) => callback({ table: 'phases', ...payload }))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `project_id=eq.${projectId}` },
              (payload) => callback({ table: 'assets', ...payload }))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` },
              (payload) => callback({ table: 'tasks', ...payload }))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `project_id=eq.${projectId}` },
              (payload) => callback({ table: 'files', ...payload }))
          .subscribe();
      })();

      return () => {
        cancelled = true;
        if (channel) channel.unsubscribe();
      };
    },
  };
}
