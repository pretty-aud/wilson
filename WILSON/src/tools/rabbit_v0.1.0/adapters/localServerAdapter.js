// ============================================================
// RABBIT v0.1 — Local Server adapter (FULL CRUD)
// ============================================================
//
// Talks to Express routes under /api/rabbit/* in electron/main.cjs.
// Persists JSON bundles under {userData}/rabbit-data/projects/.
//
// Single-user / offline-first. No realtime, no auth.
// File payloads are sent as base64 inside JSON to keep the surface
// area off a multipart parser dependency. The 50mb express.json
// limit is the upper bound; larger files should be added in v0.2
// when streaming uploads are wired.

const BASE = '/api/rabbit';

let lastError  = null;
let lastSyncAt = null;

async function jfetch(url, init) {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      lastError = msg;
      throw new Error(`[localServer] ${msg}`);
    }
    lastError  = null;
    lastSyncAt = new Date();
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.blob();
  } catch (err) {
    lastError = err.message || String(err);
    throw err;
  }
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function localServerAdapter() {
  return {
    mode: 'local_server',

    async status() {
      try {
        const list = await jfetch(`${BASE}/projects`);
        return { online: Array.isArray(list), lastSyncAt, error: null };
      } catch (err) {
        return { online: false, lastSyncAt, error: err.message || String(err) };
      }
    },

    // ── Projects ──────────────────────────────────────────────
    listProjects: () => jfetch(`${BASE}/projects`),

    async loadProject(id) {
      const bundle = await jfetch(`${BASE}/projects/${id}`);
      // Local server stores everything in one bundle file; align the
      // shape with what the Supabase adapter returns.
      return {
        project:       bundle.project,
        phases:        bundle.phases || [],
        assets:        bundle.assets || [],
        tasks:         bundle.tasks || [],
        dependencies:  bundle.dependencies || [],
        taskLinks:     bundle.taskLinks || [],
        files:         bundle.files || [],
        assetVersions: bundle.assetVersions || [],
        comments:      bundle.comments || [],
        ingestionRuns: bundle.ingestionRuns || [],
        teamAssignments: bundle.teamAssignments || [],
        managedFiles:    bundle.managedFiles || [],
        budgetVersions:  bundle.budgetVersions || [],
      };
    },

    createProject: (project) => jfetch(`${BASE}/projects`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(project),
    }),

    updateProject: (id, patch) => jfetch(`${BASE}/projects/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),

    deleteProject: (id) => jfetch(`${BASE}/projects/${id}`, { method: 'DELETE' }),

    // ── Generic sub-entity helpers ────────────────────────────
    listPhases: async (projectId) => (await jfetch(`${BASE}/projects/${projectId}`)).phases || [],
    upsertPhase: (phase) => jfetch(`${BASE}/projects/${phase.project_id}/phases`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(phase),
    }),
    deletePhase: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/phases/${id}`, { method: 'DELETE' }),

    listAssets: async (projectId) => (await jfetch(`${BASE}/projects/${projectId}`)).assets || [],
    upsertAsset: (asset) => jfetch(`${BASE}/projects/${asset.project_id}/assets`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(asset),
    }),
    deleteAsset: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/assets/${id}`, { method: 'DELETE' }),

    listTasks: async (projectId) => (await jfetch(`${BASE}/projects/${projectId}`)).tasks || [],
    upsertTask: (task) => jfetch(`${BASE}/projects/${task.project_id}/tasks`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(task),
    }),
    deleteTask: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/tasks/${id}`, { method: 'DELETE' }),

    upsertDependency: (dep) => jfetch(`${BASE}/projects/${dep.project_id}/dependencies`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(dep),
    }),
    deleteDependency: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/dependencies/${id}`, { method: 'DELETE' }),

    upsertTaskLink: (link) => jfetch(`${BASE}/projects/${link.project_id}/task-links`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(link),
    }),
    deleteTaskLink: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/task-links/${id}`, { method: 'DELETE' }),

    // ── Files ─────────────────────────────────────────────────
    async uploadFile(projectId, scope, file) {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      return jfetch(`${BASE}/projects/${projectId}/files`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:      file.name,
          mimeType:  file.type,
          sizeBytes: file.size,
          base64,
          scope,
        }),
      });
    },

    listFiles: async (projectId) => (await jfetch(`${BASE}/projects/${projectId}`)).files || [],

    async downloadFile(file) {
      const res = await fetch(`${BASE}/projects/${file.project_id}/files/${file.id}/download`);
      if (!res.ok) throw new Error(`[localServer] download HTTP ${res.status}`);
      return res.blob();
    },

    updateFile: (id, patch) => jfetch(`${BASE}/projects/${patch.project_id}/files/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),

    deleteFile: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/files/${id}`, { method: 'DELETE' }),

    // ── Asset versions ────────────────────────────────────────
    upsertAssetVersion: (version) => jfetch(`${BASE}/projects/${version.project_id}/asset-versions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(version),
    }),
    listAssetVersions: async (assetId, projectId) => {
      const bundle = await jfetch(`${BASE}/projects/${projectId}`);
      return (bundle.assetVersions || []).filter(v => v.asset_id === assetId);
    },

    // ── Comments ──────────────────────────────────────────────
    createComment: (comment) => jfetch(`${BASE}/projects/${comment.project_id}/comments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(comment),
    }),
    listComments: async (entityType, entityId, projectId) => {
      const bundle = await jfetch(`${BASE}/projects/${projectId}`);
      return (bundle.comments || []).filter(c => c.entity_type === entityType && c.entity_id === entityId);
    },
    deleteComment: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/comments/${id}`, { method: 'DELETE' }),

    // ── Ingestion runs + chunks ───────────────────────────────
    createIngestionRun: (run) => jfetch(`${BASE}/projects/${run.project_id}/ingestion-runs`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(run),
    }),
    updateIngestionRun: (runId, patch) => jfetch(`${BASE}/projects/${patch.project_id}/ingestion-runs/${runId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    listIngestionChunks: (runId, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/ingestion-runs/${runId}/chunks`),
    upsertIngestionChunk: (chunk) => jfetch(`${BASE}/projects/${chunk.project_id}/ingestion-chunks`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(chunk),
    }),
    updateChunk: (chunk) => jfetch(`${BASE}/projects/${chunk.project_id}/ingestion-chunks/${chunk.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(chunk),
    }),

    // ── Rate cards ────────────────────────────────────────────
    listRateCards: (workspaceId) => jfetch(`${BASE}/workspaces/${workspaceId}/rate-cards`),
    upsertRateCard: (card) => jfetch(`${BASE}/workspaces/${card.workspace_id}/rate-cards`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(card),
    }),
    deleteRateCard: (id) => jfetch(`${BASE}/rate-cards/${id}`, { method: 'DELETE' }),
    listRateCardEntries: (rateCardId) => jfetch(`${BASE}/rate-cards/${rateCardId}/entries`),
    upsertRateCardEntry: (entry) => jfetch(`${BASE}/rate-cards/${entry.rate_card_id}/entries`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
    }),
    deleteRateCardEntry: (id, rateCardId) => jfetch(`${BASE}/rate-cards/${rateCardId}/entries/${id}`, { method: 'DELETE' }),

    // ── Department defaults (per rate card) ──────────────────────
    listDeptDefaults: (rateCardId) => jfetch(`${BASE}/rate-cards/${rateCardId}/dept-defaults`),
    upsertDeptDefault: (rateCardId, data) => jfetch(`${BASE}/rate-cards/${rateCardId}/dept-defaults`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    }),

    // ── Team assignments (project-scoped) ──────────────────────
    upsertTeamAssignment: (assignment) => jfetch(`${BASE}/projects/${assignment.project_id}/team-assignments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(assignment),
    }),
    deleteTeamAssignment: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/team-assignments/${id}`, { method: 'DELETE' }),

    // ── Team members ───────────────────────────────────────────
    listTeamMembers: (workspaceId) => jfetch(`${BASE}/workspaces/${workspaceId}/team-members`),
    upsertTeamMember: (member) => jfetch(`${BASE}/workspaces/${member.workspace_id}/team-members`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(member),
    }),
    updateTeamMember: (id, patch) => jfetch(`${BASE}/team-members/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    deleteTeamMember: (id) => jfetch(`${BASE}/team-members/${id}`, { method: 'DELETE' }),

    // ── Managed files ─────────────────────────────────────────
    listManagedFiles: (projectId) => jfetch(`${BASE}/projects/${projectId}/managed-files`),

    createManagedFile: (record) => jfetch(`${BASE}/projects/${record.project_id}/managed-files`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(record),
    }),

    updateManagedFile: (id, patch) => jfetch(`${BASE}/projects/${patch.project_id}/managed-files/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),

    deleteManagedFile: async (id, projectId, hard = false) =>
      jfetch(`${BASE}/projects/${projectId}/managed-files/${id}?hard=${hard}`, { method: 'DELETE' }),

    importFolder: (projectId, folderPath) => jfetch(`${BASE}/projects/${projectId}/managed-files/import-folder`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ folderPath }),
    }),

    // ── Budget versions ─────────────────────────────────────────
    listBudgetVersions: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).budgetVersions || [],
    upsertBudgetVersion: (version) => jfetch(`${BASE}/projects/${version.project_id}/budget-versions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(version),
    }),
    deleteBudgetVersion: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/budget-versions/${id}`, { method: 'DELETE' }),

    // ── Expenses ────────────────────────────────────────────────
    listExpenses: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).expenses || [],
    upsertExpense: (expense) => jfetch(`${BASE}/projects/${expense.project_id}/expenses`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(expense),
    }),
    updateExpense: (id, projectId, patch) => jfetch(`${BASE}/projects/${projectId}/expenses/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    deleteExpense: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/expenses/${id}`, { method: 'DELETE' }),

    // ── Task templates ──────────────────────────────────────────
    listTaskTemplates: (workspaceId) => jfetch(`${BASE}/workspaces/${workspaceId}/task-templates`),
    listProjectTaskTemplates: (projectId) => jfetch(`${BASE}/projects/${projectId}/task-templates`),
    upsertTaskTemplate: (template) => jfetch(`${BASE}/workspaces/${template.workspace_id}/task-templates`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(template),
    }),
    updateTaskTemplate: (id, patch) => jfetch(`${BASE}/task-templates/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    deleteTaskTemplate: (id) => jfetch(`${BASE}/task-templates/${id}`, { method: 'DELETE' }),

    // ── Realtime ──────────────────────────────────────────────
    // No-op for the local backend. Returns an unsubscribe function
    // so callers can wire it the same way as Supabase without
    // branching on adapter mode.
    subscribeProjectChanges: () => () => {},
  };
}
