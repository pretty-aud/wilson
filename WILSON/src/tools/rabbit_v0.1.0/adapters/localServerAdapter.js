// ============================================================
// RABBIT v0.1 — Local Server adapter (FULL CRUD)
// ============================================================
//
// Talks to Express routes under /api/rabbit/* in electron/main.cjs.
// Persists JSON bundles under {userData}/rabbit-data/projects/.
//
// Single-user / offline-first. No realtime, no auth.
// File bodies STREAM to PUT …/files-stream (electron/projectFileStream.cjs,
// demo 2026-09-11) as application/octet-stream — the File is read from disk
// by Chromium, never buffered here. Until that night they travelled as
// base64 inside a JSON POST, which the server's 50mb json limit capped at
// roughly 37 MB of file: Audrey's "[localServer] HTTP 413" adding one clip.

import { streamPutJson } from '../storage/localServerProvider';
import { describeSourceFile } from '../storage/mediaMetadata';

import { byMilestoneDate } from '../state/milestoneOrder';

// B3 (Track B): every request below goes to the desktop loopback server, which
// refuses /api without the per-launch token. localFetch attaches the header;
// the cookie main sets would carry these too, and both arms being present is
// the point — see src/lib/localServerFetch.js.
import { localFetch } from '../../../lib/localServerFetch.js';

const BASE = '/api/rabbit';

let lastError  = null;
let lastSyncAt = null;

async function jfetch(url, init) {
  try {
    const res = await localFetch(url, init);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let code = null;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
        if (body?.code) code = String(body.code);
      } catch { /* ignore */ }
      lastError = msg;
      // The status and the route's `code` ride on the error (review round 2:
      // a caller branching on "offline" had only the sentence to read, and
      // the sentence does not contain the word).
      const err = new Error(`[localServer] ${msg}`);
      err.status = res.status;
      if (code) err.code = code;
      throw err;
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



// Session 26: the folder tree is returned in path order on BOTH backends.
// Supabase does it with `.order('path')`; the local bundle is a plain array,
// so it is sorted here. Copied rather than sorted in place — the caller owns
// the bundle and mutating it would reorder the file on the next write.
function sortByPath(rows) {
  return [...(rows || [])].sort((a, b) => String(a.path).localeCompare(String(b.path)))
}

// Mirrors the supabase adapter's `.order('date').order('id')` for milestones.
// Postgres sorts NULLs LAST on an ascending order by default, so an undated key
// date goes to the end here too — the editor refuses to save one, but a row
// written before that check existed can still carry a null.
//
// 🚨 TWO THINGS R2 MEASURED, both fixed here and in the cloud query.
// (a) TIES. `ORDER BY date` alone leaves equal dates in an arbitrary
//     heap order, while Array.prototype.sort is spec-stable and keeps bundle
//     insertion order — so two key dates on the same day could render in
//     different orders on the two backends, which is the exact symptom this
//     sort was added to remove. Both sides now break ties on `id`.
// (b) FORMAT. localeCompare is a string compare, and '2026-1-5' sorts AFTER
//     '2026-01-15' where Postgres orders them Jan 5 then Jan 15. `<input
//     type="date">` always emits padded ISO, so this needs a hand-edited or
//     imported bundle to reach — but comparing as dates costs nothing.
// byMilestoneDate moved to state/milestoneOrder.js when key dates gained live
// sync (0077): realtimeMerge needs the same order, and a comparator defined in
// two places is A2 session 1's "done was defined twice" finding waiting to
// happen again. The tests in loadProjectBundle.test.js still drive it through
// listMilestones, so they cover the move as well as the order.

// Post-overhaul S3a (0084): shot lists and edits come back ordered by
// created_at then id, shot-list items by position then id — the orders the
// Supabase adapter asks Postgres for. Same trap as folders and milestones: the
// bundle is an array in INSERTION order, and a replace of one list's items
// appends that list's rows at the end. Code-unit comparison (not
// localeCompare) on purpose: created_at is fixed-width ISO, and a lower-case
// uuid compared by code unit sorts as Postgres sorts the uuid. Copies, never
// in place — the caller owns the bundle.
function cmpCodeUnits(a, b) {
  const x = a == null ? '' : String(a)
  const y = b == null ? '' : String(b)
  if (x < y) return -1
  if (x > y) return 1
  return 0
}
function sortByCreatedThenId(rows) {
  return [...(rows || [])].sort((a, b) => cmpCodeUnits(a?.created_at, b?.created_at) || cmpCodeUnits(a?.id, b?.id))
}
function sortByPositionThenId(rows) {
  return [...(rows || [])].sort((a, b) => ((Number(a?.position) || 0) - (Number(b?.position) || 0)) || cmpCodeUnits(a?.id, b?.id))
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
        budgetLines:     bundle.budgetLines || [],
        budgetActuals:   bundle.budgetActuals || [],
        projectTeam:     bundle.projectTeam || [],
        scenes:          bundle.scenes || [],
        shots:           bundle.shots || [],
        levels:          bundle.levels || [],
        experiences:     bundle.experiences || [],
        // Session 26 — same reason as every key above it: setActiveProject
        // does setBundle({ ...EMPTY_BUNDLE, ...next }), so an omitted key is
        // reset to [] on every load, project switch and realtime refetch.
        //
        // Sorted by path to match the Supabase adapter's `.order('path')`.
        // The bundle is an array and therefore in INSERTION order — root,
        // then categories, then whichever entity happened to be created
        // first — so without this the two backends return the same tree in
        // different orders and any consumer that trusts the order (a
        // depth-first render, say) draws two different pictures. Same trap
        // S25 called out for scenes, where the fix was `.order('sort_order')`.
        folders:         sortByPath(bundle.folders),
        // Session 17 (§6 #47): omitting this dropped every milestone on load.
        // setActiveProject does setBundle({...EMPTY_BUNDLE, ...next}), so a
        // missing key reset the array — real data loss on every reload,
        // project switch and realtime refetch.
        //
        // A2 session 2, ruling 38: trashed milestones are FILTERED OUT here,
        // not deleted on the server. The desktop DELETE now stamps deleted_at
        // (main.cjs, the softDelete opt) and the row stays in the bundle so
        // Undo and "Recently deleted" have something to restore. This filter
        // is what keeps it off the timeline, and it is the local mirror of
        // milestones_select's `deleted_at IS NULL` arm in 0067 — the two
        // backends must hide the same rows or the same project looks
        // different depending on where it is stored.
        milestones:      (bundle.milestones || [])
          .filter(m => !m.deleted_at)
          .sort(byMilestoneDate),
        // The bin system (demo 2026-09-11) — same reason as every key above.
        // `binFiles` here carry no `online` flag (the bundle is read raw); the
        // provider refreshes through listBins, whose route stats every path.
        bins:            bundle.bins || [],
        binFiles:        bundle.binFiles || [],
        binRoots:        bundle.binRoots || [],
        shotTakes:       bundle.shotTakes || [],
        // Post-overhaul S3a (0084) — same reason as every key above: omitted,
        // the EMPTY_BUNDLE spread would reset them to [] on every load, and
        // every surface that reads the ACTIVE list (D10) would fall back to
        // "every scene and shot". Sorted as the cloud orders them.
        shotLists:       sortByCreatedThenId(bundle.shotLists),
        shotListItems:   sortByPositionThenId(bundle.shotListItems),
        edits:           sortByCreatedThenId(bundle.edits),
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
    // Demo 2026-09-11 (Audrey: "[localServer] HTTP 413" adding a file to a
    // project). The body STREAMS to the server — Chromium reads the File
    // from disk in chunks; nothing is buffered here or there — with the
    // metadata in the query string. Same row, same directories, same
    // 'uploaded' event as the base64 POST it replaces (which stays mounted
    // for anything else that calls it). `onProgress` rides XHR when given.
    async uploadFile(projectId, scope, file, opts = {}) {
      // Demo 2026-09-11: the file's own facts ride along — duration (audio
      // / video, read by a media element, best-effort) and the source's
      // modified time — so the local row says the same as the cloud row.
      const facts = await describeSourceFile(file);
      const q = new URLSearchParams({
        name:      file?.name || 'file',
        mimeType:  file?.type || '',
        sizeBytes: file?.size == null ? '' : String(file.size),
        scope:     JSON.stringify(scope || {}),
        durationSec:      facts.durationSec == null ? '' : String(facts.durationSec),
        sourceModifiedAt: facts.sourceModifiedAt || '',
      });
      try {
        const row = await streamPutJson(`${BASE}/projects/${projectId}/files-stream?${q}`, file, {
          onProgress: opts.onProgress,
          label: '[localServer] upload failed',
        });
        lastError = null;
        lastSyncAt = new Date();
        return row;
      } catch (err) {
        lastError = err.message || String(err);
        throw err;
      }
    },

    listFiles: async (projectId) => (await jfetch(`${BASE}/projects/${projectId}`)).files || [],

    async downloadFile(file) {
      const res = await localFetch(`${BASE}/projects/${file.project_id}/files/${file.id}/download`);
      if (!res.ok) throw new Error(`[localServer] download HTTP ${res.status}`);
      return res.blob();
    },

    updateFile: (id, patch) => jfetch(`${BASE}/projects/${patch.project_id}/files/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),

    // S4a (0085): the bundle holds whatever the PATCH merges, and the route
    // holds `tags` to the nine (electron/fileTags.cjs) — always available.
    supportsFileTags: async () => true,

    // S4a (E9): a Local Server file has URLs at last, so ctx.fileUrl and
    // ctx.downloadUrl answer on all three backends. Same-origin paths: the
    // httpOnly launch cookie carries them for an <img>, a <video>, an
    // <audio> or a fetch, which cannot set the token header (B3).
    //   fileUrl     → the stream route (inline, Range, one 'downloaded' a
    //                 minute — the preview's read is logged there, E13)
    //   downloadUrl → the download route as an ATTACHMENT under the file's
    //                 name (`?download=1`), so an <a> click saves it
    async fileUrl(file) {
      if (!file?.id || !file?.project_id) return null;
      return `${BASE}/projects/${encodeURIComponent(file.project_id)}/files/${encodeURIComponent(file.id)}/stream`;
    },
    async downloadUrl(file) {
      if (!file?.id || !file?.project_id) return null;
      return `${BASE}/projects/${encodeURIComponent(file.project_id)}/files/${encodeURIComponent(file.id)}/download?download=1`;
    },

    deleteFile: async (id, projectId) => jfetch(`${BASE}/projects/${projectId}/files/${id}`, { method: 'DELETE' }),

    // ── File lifecycle + storage relink (Session 14) ──────────
    // listFileEvents mirrors the cloud file_events stream; the server
    // appends to bundle.fileEvents on upload/relink/delete.
    listFileEvents: async (fileId, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/files/${fileId}/events`),

    // Scan: dangling rows + (optionally) a recursive walk of folderPath.
    relinkScan: (projectId, folderPath = null) =>
      jfetch(`${BASE}/projects/${projectId}/files/relink-scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(folderPath ? { folderPath } : {}),
      }),

    // Apply: bulk storage_path remap, all-or-nothing on the server.
    relinkApply: (projectId, baseDir, mappings) =>
      jfetch(`${BASE}/projects/${projectId}/files/relink-apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ baseDir, mappings }),
      }),

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

    // ── Edit history ──────────────────────────────────────────
    // No capture in local mode (DB-trigger feature, supabase only).
    // Empty result → the drawer shows its "unavailable in this mode" note.
    listEditHistory: async () => [],

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

    // ── Project team (project-scoped copy of workspace members) ──
    listProjectTeam: (projectId) => jfetch(`${BASE}/projects/${projectId}/project-team`),
    syncProjectTeam: (projectId, members) => jfetch(`${BASE}/projects/${projectId}/project-team/sync`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ members }),
    }),

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

    // ── Project rate overrides (Session 24) ─────────────────────
    // A rate edited inside a project is PROJECT-SCOPED and must never write
    // back to the workspace rate card. Same shape as the Supabase adapter so
    // one UI serves both backends.
    listProjectRateOverrides: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).projectRateOverrides || [],
    upsertProjectRateOverride: (override) =>
      jfetch(`${BASE}/projects/${override.project_id}/project-rate-overrides`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(override),
      }),
    deleteProjectRateOverride: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/project-rate-overrides/${id}`, { method: 'DELETE' }),

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

    // ── Budget lines ───────────────────────────────────────────
    listBudgetLines: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).budgetLines || [],
    upsertBudgetLine: (line) => jfetch(`${BASE}/projects/${line.project_id}/budget-lines`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(line),
    }),
    updateBudgetLine: (id, projectId, patch) => jfetch(`${BASE}/projects/${projectId}/budget-lines/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    deleteBudgetLine: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/budget-lines/${id}`, { method: 'DELETE' }),

    // ── Budget actuals ──────────────────────────────────────────
    listBudgetActuals: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).budgetActuals || [],
    upsertBudgetActual: (actual) => jfetch(`${BASE}/projects/${actual.project_id}/budget-actuals`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(actual),
    }),
    updateBudgetActual: (id, projectId, patch) => jfetch(`${BASE}/projects/${projectId}/budget-actuals/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    }),
    deleteBudgetActual: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/budget-actuals/${id}`, { method: 'DELETE' }),

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

    // ── Scenes ─────────────────────────────────────────────────
    listScenes: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).scenes || [],
    upsertScene: (scene) => jfetch(`${BASE}/projects/${scene.project_id}/scenes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(scene),
    }),
    deleteScene: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/scenes/${id}`, { method: 'DELETE' }),

    // ── Shots ──────────────────────────────────────────────────
    listShots: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).shots || [],
    upsertShot: (shot) => jfetch(`${BASE}/projects/${shot.project_id}/shots`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(shot),
    }),
    deleteShot: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/shots/${id}`, { method: 'DELETE' }),

    // ── Shot lists, items and edits (post-overhaul S3a, 0084) ──────────────
    //
    // The same twelve methods, with the same signatures, on every adapter (the
    // S3a contract, its round-1 addendum, which added the two membership
    // DELTA writes, and its round-2 addendum, which added the positions-only
    // reorder). The routes are electron/rabbitShotLists.cjs; they refuse
    // with `{ error, code }`, which jfetch turns into an Error carrying
    // `.status` and `.code`. Lists and edits are archived, never deleted
    // (D4/D18), so there is no delete method. The list* methods read the
    // bundle, as listScenes does — there is no GET route per collection.
    listShotLists: async (projectId) =>
      sortByCreatedThenId((await jfetch(`${BASE}/projects/${projectId}`)).shotLists),
    upsertShotList: async (list) => {
      if (!list?.project_id) throw new Error('[localServer] upsertShotList needs list.project_id')
      return jfetch(`${BASE}/projects/${list.project_id}/shot-lists`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(list),
      })
    },
    listShotListItems: async (projectId) =>
      sortByPositionThenId((await jfetch(`${BASE}/projects/${projectId}`)).shotListItems),
    // The WHOLE membership of one list, in one request: rows not named are
    // removed, named ids keep their rows. Answers that list's rows, ordered.
    // For tooling and bulk restores — a whole set sent from one client's view
    // deletes what a collaborator added since it loaded (review R1), so the
    // provider writes the two deltas below instead.
    replaceShotListItems: (projectId, listId, items) =>
      jfetch(`${BASE}/projects/${projectId}/shot-lists/${listId}/items`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items }),
      }),
    // Addendum A: write ONLY the named rows of one list — new ids inserted,
    // this list's ids updated, another list's ids skipped, nothing deleted.
    // Answers the rows written. POST where replace is PUT: same URL, and the
    // verb is what tells the route "delta" from "whole set".
    upsertShotListItems: (projectId, listId, items) =>
      jfetch(`${BASE}/projects/${projectId}/shot-lists/${listId}/items`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items }),
      }),
    // R2-2: a REORDER (and its undo / redo) — move rows that EXIST in this
    // list to the given positions and nothing else. An id that names nothing
    // (a row a collaborator removed since this client loaded) or another
    // list's row is skipped, never inserted: the upsert above would have put
    // the removed row back. Answers the rows updated. Each item is cut to
    // { id, position } — scene_id / shot_id play no part in a move — and a
    // payload that is not an array is passed through for the route to refuse
    // with its own message rather than thrown here as a TypeError.
    repositionShotListItems: (projectId, listId, items) =>
      jfetch(`${BASE}/projects/${projectId}/shot-lists/${listId}/items`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          items: Array.isArray(items) ? items.map(i => ({ id: i?.id, position: i?.position })) : items,
          positionsOnly: true,
        }),
      }),
    // Addendum A: delete exactly these item ids of one list (ids of another
    // list, or of nothing, are ignored). Answers { deleted: [ids] }.
    deleteShotListItems: (projectId, listId, itemIds) =>
      jfetch(`${BASE}/projects/${projectId}/shot-lists/${listId}/items/delete`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: itemIds }),
      }),
    listEdits: async (projectId) =>
      sortByCreatedThenId((await jfetch(`${BASE}/projects/${projectId}`)).edits),
    upsertEdit: async (edit) => {
      if (!edit?.project_id) throw new Error('[localServer] upsertEdit needs edit.project_id')
      return jfetch(`${BASE}/projects/${edit.project_id}/edits`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(edit),
      })
    },
    // null clears the active list. `listId ?? null`, never a bare listId:
    // JSON.stringify drops an undefined key, and the route refuses a body
    // without one rather than guess that it meant "clear".
    setActiveShotList: async (projectId, listId) =>
      (await jfetch(`${BASE}/projects/${projectId}/active-shot-list`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listId: listId ?? null }),
      }))?.active_shot_list_id ?? null,
    archiveShotList: (projectId, listId, archived = true) =>
      jfetch(`${BASE}/projects/${projectId}/shot-lists/${listId}/archive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ archived: archived !== false }),
      }),
    archiveEdit: (projectId, editId, archived = true) =>
      jfetch(`${BASE}/projects/${projectId}/edits/${editId}/archive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ archived: archived !== false }),
      }),

    // ── Levels ─────────────────────────────────────────────────
    listLevels: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).levels || [],
    upsertLevel: (level) => jfetch(`${BASE}/projects/${level.project_id}/levels`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(level),
    }),
    deleteLevel: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/levels/${id}`, { method: 'DELETE' }),

    // ── Experiences ────────────────────────────────────────────
    listExperiences: async (projectId) =>
      (await jfetch(`${BASE}/projects/${projectId}`)).experiences || [],
    upsertExperience: (experience) => jfetch(`${BASE}/projects/${experience.project_id}/experiences`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(experience),
    }),
    deleteExperience: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/experiences/${id}`, { method: 'DELETE' }),

    // ── Folders (Session 26) ───────────────────────────────────
    //
    // The same three methods the Supabase adapter exposes, so the provider
    // calls one interface. The difference is where the work happens: here the
    // Express route creates REAL DIRECTORIES with fs.mkdirSync and records
    // them in the bundle, because Local Server has an actual filesystem.
    //
    // Both sides plan the tree with the same folderPaths.js, which is what
    // stops the two backends filing the same project differently.
    listFolders: async (projectId) =>
      sortByPath((await jfetch(`${BASE}/projects/${projectId}`)).folders),

    ensureProjectFolders: (projectId) =>
      jfetch(`${BASE}/projects/${projectId}/folders/ensure`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      }),

    // The project is NOT sent: the server reads it from the bundle, which is
    // the copy the folder actually has to agree with. Sending the client's
    // copy would let a stale render create a folder under the old name.
    ensureEntityFolder: (projectId, project, entityType, entity) =>
      jfetch(`${BASE}/projects/${projectId}/folders/ensure-entity`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ entityType, entityId: entity?.id }),
      }),

    deleteFolder: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/folders/${id}`, { method: 'DELETE' }),

    // The manifest is written by the SERVER, not posted from here: the server
    // has the bundle, and the bundle is the copy the file has to mirror.
    // Posting a client-built manifest would let a stale render write a
    // description of a project as it was three edits ago.
    writeProjectManifest: (projectId) =>
      jfetch(`${BASE}/projects/${projectId}/manifest`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      }),

    // Session 27. Same server-builds-it reasoning as the manifest, and the
    // mirror argument is accepted and IGNORED so one provider call serves both
    // backends: the server reads the overrides from the bundle, which is the
    // copy the file has to agree with. On Supabase the equivalent method is
    // handed a client-built mirror because there is no server to build one.
    writeProjectRates: (projectId, _mirror) =>
      jfetch(`${BASE}/projects/${projectId}/rates-mirror`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      }),

    // ── Milestones ────────────────────────────────────────────
    //
    // A2 session 2, ruling 38: trash and undo, on BOTH backends. The DELETE
    // below is unchanged as a call — the SERVER now stamps deleted_at rather
    // than splicing (main.cjs, the softDelete opt) — and the two new methods
    // mirror the supabase adapter's restoreMilestone / listTrashedMilestones
    // so RabbitProvider needs no per-adapter branch beyond the capability
    // check it already does for phases (`typeof adapter.restorePhase`).
    // Sorted by date to match the supabase adapter's `.order('date')`. The
    // bundle is an array and therefore in INSERTION order, so without this the
    // two backends return the same project's key dates in different orders —
    // invisible on the Gantt, which draws by date, but visible in
    // ProjectTasksView's milestone rows, which render array order. R1 caught
    // the "both adapters agree" claim being false. Same trap S25 called out
    // for scenes and S26 for folders.
    listMilestones: async (projectId) =>
      ((await jfetch(`${BASE}/projects/${projectId}`)).milestones || [])
        .filter(m => !m.deleted_at)
        .sort(byMilestoneDate),
    upsertMilestone: (milestone) => jfetch(`${BASE}/projects/${milestone.project_id}/milestones`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(milestone),
    }),
    deleteMilestone: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/milestones/${id}`, { method: 'DELETE' }),
    // The HARD delete — `?purge=1` on the same route. One caller: the undo of
    // a CREATE, which must leave no row and no trash entry.
    destroyMilestone: async (id, projectId) =>
      jfetch(`${BASE}/projects/${projectId}/milestones/${id}?purge=1`, { method: 'DELETE' }),
    // Answers the same boolean the cloud RPC does: false = already live.
    restoreMilestone: async (id, projectId) =>
      !!(await jfetch(`${BASE}/projects/${projectId}/milestones/${id}/restore`, {
        method: 'POST',
      })).restored,
    // "Recently deleted", newest first — the same order 0067's
    // milestones_trash_index returns. The trashed rows are already in the
    // bundle here (loadProject filters them out for the timeline), so this
    // needs no route of its own.
    listTrashedMilestones: async (projectId) =>
      ((await jfetch(`${BASE}/projects/${projectId}`)).milestones || [])
        .filter(m => m.deleted_at)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at))),

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

    // --- bins ---
    //
    // The bin system (demo 2026-09-11, docs/BINS_DESIGN.md). Local Server
    // ONLY: bin files are references to paths on this machine, the dialogs
    // open in the main process, and the bytes are served by the loopback
    // server. Neither the Supabase nor the Drive adapter defines any of
    // these; the provider feature-detects `listBins` and exposes
    // `supportsBins`. Every method takes projectId first.
    listBins: (projectId) => jfetch(`${BASE}/projects/${projectId}/bins`),
    createBin: (projectId, bin) => jfetch(`${BASE}/projects/${projectId}/bins`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bin),
    }),
    updateBin: (projectId, id, patch) => jfetch(`${BASE}/projects/${projectId}/bins/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),
    // mode 'move' needs target (the bin that receives the files); 'remove'
    // drops the references. Returns { removedBins, movedFiles, removedFiles }.
    deleteBin: (projectId, id, { mode = 'remove', target = null } = {}) =>
      jfetch(`${BASE}/projects/${projectId}/bins/${id}?mode=${mode}${target ? `&target=${encodeURIComponent(target)}` : ''}`, { method: 'DELETE' }),
    reorderBins: (projectId, order) => jfetch(`${BASE}/projects/${projectId}/bins/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }),
    }),
    pickBinFiles: (projectId) => jfetch(`${BASE}/projects/${projectId}/bins/pick-files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }),
    pickBinFolder: (projectId, title) => jfetch(`${BASE}/projects/${projectId}/bins/pick-folder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }),
    // opts.folderAsBin (default true): a picked folder becomes a nested bin named after itself.
    prepareBinFiles: (projectId, paths, opts = {}) => jfetch(`${BASE}/projects/${projectId}/bins/prepare`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, ...opts }),
    }),
    // roots (optional): the folders the batch was picked or dropped from, as
    // `prepare` reported them — the server records those as the known roots.
    addBinFiles: (projectId, binId, items, createSubBins = true, roots = null) =>
      jfetch(`${BASE}/projects/${projectId}/bins/${binId}/files`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, createSubBins, ...(roots ? { roots } : {}) }),
      }),
    updateBinFile: (projectId, id, patch) => jfetch(`${BASE}/projects/${projectId}/bin-files/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),
    bulkUpdateBinFiles: (projectId, ids, patch) => jfetch(`${BASE}/projects/${projectId}/bin-files/bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, patch }),
    }),
    // sortOrders (optional, { id: n }): an undo puts rows back at their old positions.
    moveBinFiles: (projectId, ids, binId, sortOrders = null) => jfetch(`${BASE}/projects/${projectId}/bin-files/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sortOrders ? { ids, binId, sortOrders } : { ids, binId }),
    }),
    copyBinFiles: (projectId, ids, binId) => jfetch(`${BASE}/projects/${projectId}/bin-files/copy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, binId }),
    }),
    removeBinFiles: (projectId, ids) => jfetch(`${BASE}/projects/${projectId}/bin-files/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    }),
    // → { restored, skipped: [{ id, reason }], affectedShotIds, shotTakes, orphanTakes }
    restoreBinFiles: (projectId, rows) => jfetch(`${BASE}/projects/${projectId}/bin-files/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
    }),
    probeBinFile: (projectId, id) => jfetch(`${BASE}/projects/${projectId}/bin-files/${id}/probe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }),
    // reveal:true shows the file in Explorer; otherwise the OS default app opens it.
    openBinFile: (projectId, id, reveal = false) => jfetch(`${BASE}/projects/${projectId}/bin-files/${id}/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reveal }),
    }),
    postBinFileThumbnail: (projectId, id, base64) => jfetch(`${BASE}/projects/${projectId}/bin-files/${id}/thumbnail`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64 }),
    }),
    // URL builders, not fetches: <img>, <video> and <audio> take a src.
    binFileThumbnailUrl: (projectId, id, rev = 0) =>
      `${BASE}/projects/${projectId}/bin-files/${id}/thumbnail${rev ? `?v=${rev}` : ''}`,
    binFileStreamUrl: (projectId, id, { probe = false } = {}) =>
      `${BASE}/projects/${projectId}/bin-files/${id}/stream${probe ? '?probe=1' : ''}`,
    binRelinkScan: (projectId, folderPath = null) => jfetch(`${BASE}/projects/${projectId}/bins/relink-scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(folderPath ? { folderPath } : {}),
    }),
    binRelinkApply: (projectId, mappings) => jfetch(`${BASE}/projects/${projectId}/bins/relink-apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings }),
    }),
    // Roots are recorded by the pick and add routes; this forgets one.
    removeBinRoot: (projectId, id) => jfetch(`${BASE}/projects/${projectId}/bins/roots/${id}`, { method: 'DELETE' }),

    // Shot takes (milestone 2): bin files assigned to shots, many-to-many.
    // Every mutation answers { affectedShotIds, shotTakes } — the FULL row set
    // of the shots it touched, because a role change or a removal renumbers
    // and re-roles the siblings; the provider replaces those shots' rows. The
    // rows themselves arrive with listBins (`shotTakes`); there is no separate
    // list method because nothing needs one.
    // assignments: [{ shot_id, bin_file_id, role?, notes? }] → { created, skipped, … }
    assignShotTakes: (projectId, assignments) => jfetch(`${BASE}/projects/${projectId}/shot-takes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignments }),
    }),
    // patch: { role?, notes?, position? } → { take, … }
    updateShotTake: (projectId, id, patch) => jfetch(`${BASE}/projects/${projectId}/shot-takes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),
    removeShotTakes: (projectId, ids) => jfetch(`${BASE}/projects/${projectId}/shot-takes/remove`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    }),
    reorderShotTakes: (projectId, shotId, ids) => jfetch(`${BASE}/projects/${projectId}/shot-takes/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shot_id: shotId, ids }),
    }),
    // The undo primitive: the given shots' rows become exactly `rows`.
    replaceShotTakes: (projectId, shotIds, rows) => jfetch(`${BASE}/projects/${projectId}/shot-takes/replace`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shotIds, rows }),
    }),
  };
}
